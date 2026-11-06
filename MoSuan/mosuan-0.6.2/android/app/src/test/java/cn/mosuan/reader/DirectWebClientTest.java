package cn.mosuan.reader;

import org.junit.Test;
import static org.junit.Assert.*;
import java.net.URL;
import java.net.HttpURLConnection;
import java.io.InputStream;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONObject;

public class DirectWebClientTest {
    private static class Reply {
        final int status; final String type; final byte[] body;
        Reply(int status, String type, String body) { this(status,type,body.getBytes(StandardCharsets.UTF_8)); }
        Reply(int status, String type, byte[] body) { this.status=status; this.type=type; this.body=body; }
    }
    private static class FakeConnection extends HttpURLConnection {
        final Reply reply; final ByteArrayOutputStream output = new ByteArrayOutputStream();
        boolean disconnected;
        FakeConnection(URL url, Reply reply) { super(url); this.reply=reply; }
        @Override public int getResponseCode() { return reply.status; }
        @Override public String getContentType() { return reply.type; }
        @Override public InputStream getInputStream() { return new ByteArrayInputStream(reply.body); }
        @Override public InputStream getErrorStream() { return getInputStream(); }
        @Override public OutputStream getOutputStream() { return output; }
        @Override public void disconnect() { disconnected=true; }
        @Override public boolean usingProxy() { return false; }
        @Override public void connect() {}
    }
    private static class Fixture implements DirectWebClient.Listener {
        final List<Reply> replies = new ArrayList<>(); final List<FakeConnection> connections = new ArrayList<>();
        DirectWebClient client; String chunks="", error=""; boolean ended, login, rejectProof;
        Fixture(Reply... values) throws Exception {
            java.util.Collections.addAll(replies, values);
            JSONObject auth = new JSONObject().put("token","synthetic-token-not-a-real-credential").put("cookie","synthetic=test").put("userAgent","Test client");
            client = new DirectWebClient(auth,this, bytes -> java.util.Base64.getEncoder().encodeToString(bytes), url -> {
                FakeConnection connection = new FakeConnection(url,replies.get(connections.size())); connections.add(connection); return connection;
            });
        }
        @Override public void progress(String message) {}
        @Override public void proof(JSONObject challenge, String wasm) { client.solved(rejectProof ? -1 : 7, rejectProof ? "stopped" : null); }
        @Override public void chunk(String text) { chunks += text; }
        @Override public void end() { ended=true; }
        @Override public void failure(String message, boolean loginRequired) { error=message; login=loginRequired; }
    }
    private static Reply challenge() { return new Reply(200,"application/json","{\"code\":0,\"data\":{\"biz_code\":0,\"biz_data\":{\"challenge\":{\"algorithm\":\"DeepSeekHashV1\",\"challenge\":\"abc\",\"salt\":\"salt\",\"signature\":\"sig\",\"difficulty\":1,\"expire_at\":9999999999}}}}"); }
    private static Reply wasm() { return new Reply(200,"application/wasm",new byte[]{0,97,115,109,1,0,0,0}); }
    private static Reply session() { return new Reply(200,"application/json","{\"code\":0,\"data\":{\"biz_code\":0,\"biz_data\":{\"chat_session\":{\"id\":\"test-session\"}}}}"); }
    @Test public void nativeRequestSequenceSendsAuthOnlyToWebOriginAndPreservesUtf8() throws Exception {
        Fixture fixture = new Fixture(challenge(),wasm(),session(),new Reply(200,"text/event-stream","data: {\"v\":\"中文公式\"}\n\n"));
        fixture.client.run("求积分"); assertTrue(fixture.ended); assertEquals("",fixture.error); assertTrue(fixture.chunks.contains("中文公式")); assertEquals(4,fixture.connections.size());
        FakeConnection module = fixture.connections.get(1), completion = fixture.connections.get(3);
        assertNull(module.getRequestProperty("Authorization")); assertNull(module.getRequestProperty("Cookie"));
        assertEquals("Bearer synthetic-token-not-a-real-credential",completion.getRequestProperty("Authorization"));
        assertEquals(DirectWebClient.ORIGIN+DirectWebClient.COMPLETION,completion.getURL().toString()); assertFalse(completion.getInstanceFollowRedirects());
        JSONObject body = new JSONObject(completion.output.toString("UTF-8")); assertEquals("求积分",body.getString("prompt")); assertTrue(body.isNull("parent_message_id"));
        JSONObject proof = new JSONObject(new String(java.util.Base64.getDecoder().decode(completion.getRequestProperty("X-DS-PoW-Response")),StandardCharsets.UTF_8));
        assertEquals(7,proof.getLong("answer")); assertEquals(DirectWebClient.COMPLETION,proof.getString("target_path"));
        for(FakeConnection connection:fixture.connections) assertTrue(connection.disconnected);
    }
    @Test public void expiredLoginStopsBeforeProofOrCompletion() throws Exception {
        Fixture fixture = new Fixture(new Reply(200,"application/json","{\"code\":40002,\"msg\":\"expired\"}"));
        fixture.client.run("question"); assertTrue(fixture.login); assertFalse(fixture.ended); assertEquals(1,fixture.connections.size());
    }
    @Test public void businessRateLimitOnHttp200DoesNotRetryOrFallback() throws Exception {
        Fixture fixture = new Fixture(challenge(),wasm(),session(),new Reply(200,"application/json","{\"code\":40029,\"msg\":\"TOO_MANY_REQUESTS\"}"));
        fixture.client.run("question"); assertTrue(fixture.error.contains("频繁")); assertFalse(fixture.ended); assertEquals(4,fixture.connections.size());
    }
    @Test public void proofFailureNeverSendsQuestion() throws Exception {
        Fixture fixture = new Fixture(challenge(),wasm()); fixture.rejectProof=true; fixture.client.run("question");
        assertFalse(fixture.ended); assertFalse(fixture.error.isEmpty()); assertEquals(2,fixture.connections.size());
    }
    @Test public void cdnRedirectIsRejectedWithoutLeakingAuth() throws Exception {
        Fixture fixture = new Fixture(challenge(),new Reply(302,"text/plain","redirect")); fixture.client.run("question");
        assertFalse(fixture.ended); assertFalse(fixture.error.isEmpty()); assertEquals(2,fixture.connections.size());
        assertNull(fixture.connections.get(1).getRequestProperty("Authorization")); assertFalse(fixture.connections.get(1).getInstanceFollowRedirects());
    }
    @Test public void cancellationBeforeStartDoesNotOpenConnections() throws Exception {
        Fixture fixture = new Fixture(); fixture.client.cancel(); fixture.client.run("question");
        assertEquals(0,fixture.connections.size()); assertFalse(fixture.ended); assertEquals("",fixture.error);
    }
    @Test public void wasmUrlsAndHeaderInjectionAreRejected() throws Exception {
        assertTrue(DirectWebClient.validWasm(DirectWebClient.DEFAULT_WASM));
        for(String url:new String[]{"http://fe-static.deepseek.com/a.wasm","https://evil.test/a.wasm","https://fe-static.deepseek.com.evil.test/a.wasm","https://user@fe-static.deepseek.com/a.wasm","https://fe-static.deepseek.com/a.wasm?token=secret"}) assertFalse(DirectWebClient.validWasm(url));
        try { DirectWebClient.header("x\r\nAuthorization:bad"); fail("header injection"); } catch(Exception expected) {}
    }
    private static Reply file(String status) { return new Reply(200,"application/json","{\"code\":0,\"data\":{\"biz_code\":0,\"biz_data\":{\"id\":\"image-1\",\"status\":\""+status+"\"}}}"); }
    private static DirectWebClient.Image picture() { return new DirectWebClient.Image("question.jpg",new byte[]{(byte)255,(byte)216,(byte)255,(byte)217}); }
    @Test public void uploadsImageWithOwnProofWaitsForParseAndPassesReferenceToCompletion() throws Exception {
        Fixture f = new Fixture(challenge(),wasm(),file("PENDING"),new Reply(200,"application/json","{\"code\":0,\"data\":{\"biz_code\":0,\"biz_data\":{\"files\":[{\"id\":\"image-1\",\"status\":\"SUCCESS\"}]}}}"),challenge(),wasm(),session(),new Reply(200,"text/event-stream","data: [DONE]\n\n"));
        f.client.run("Read attachment 1",java.util.Collections.singletonList(picture()));
        assertTrue(f.ended); assertEquals("",f.error); assertEquals(8,f.connections.size());
        FakeConnection upload = f.connections.get(2), fetch = f.connections.get(3), complete = f.connections.get(7);
        assertEquals(DirectWebClient.ORIGIN+DirectWebClient.UPLOAD,upload.getURL().toString());
        assertTrue(upload.getRequestProperty("Content-Type").startsWith("multipart/form-data; boundary=Mosuan-"));
        assertTrue(upload.output.toString("ISO-8859-1").contains("name=\"file\"; filename=\"image-1.jpg\""));
        assertEquals("4",upload.getRequestProperty("x-file-size")); assertEquals("GET",fetch.getRequestMethod());
        JSONObject uploadPow = new JSONObject(new String(java.util.Base64.getDecoder().decode(upload.getRequestProperty("X-DS-PoW-Response")),StandardCharsets.UTF_8));
        assertEquals(DirectWebClient.UPLOAD,uploadPow.getString("target_path"));
        assertEquals("image-1",new JSONObject(complete.output.toString("UTF-8")).getJSONArray("ref_file_ids").getString(0));
        assertNull(f.connections.get(1).getRequestProperty("Authorization")); assertNull(f.connections.get(5).getRequestProperty("Authorization"));
    }
    @Test public void failedImageParseNeverSendsTextWithoutItsImage() throws Exception {
        Fixture f = new Fixture(challenge(),wasm(),file("CONTENT_FILTER"));
        f.client.run("picture",java.util.Collections.singletonList(picture()));
        assertFalse(f.ended); assertTrue(f.error.contains("解析图片")); assertEquals(3,f.connections.size());
    }
    @Test public void sendsAllSevenFileReferencesInOrder() throws Exception {
        List<Reply> replies = new ArrayList<>();
        List<DirectWebClient.Image> images = new ArrayList<>();
        for (int i = 1; i <= 7; i++) {
            replies.add(challenge());
            replies.add(wasm());
            replies.add(new Reply(200, "application/json", new JSONObject().put("code", 0).put("data", new JSONObject()
                .put("biz_code", 0).put("biz_data", new JSONObject().put("id", "file-" + i).put("status", "SUCCESS"))).toString()));
            images.add(picture());
        }
        replies.add(challenge()); replies.add(wasm()); replies.add(session());
        replies.add(new Reply(200, "text/event-stream", "data: [DONE]\n\n"));
        Fixture f = new Fixture(replies.toArray(new Reply[0]));
        f.client.run("Read seven attachments", images);
        assertTrue(f.error, f.ended);
        assertEquals(replies.size(), f.connections.size());
        FakeConnection complete = f.connections.get(f.connections.size() - 1);
        org.json.JSONArray refs = new JSONObject(complete.output.toString("UTF-8")).getJSONArray("ref_file_ids");
        assertEquals(7, refs.length());
        for (int i = 0; i < 7; i++) assertEquals("file-" + (i + 1), refs.getString(i));
    }
    @Test public void uploadAuthFailureKeepsLoginErrorAndDoesNotRetry() throws Exception {
        Fixture f = new Fixture(challenge(),wasm(),new Reply(401,"application/json","{\"code\":40002}"));
        f.client.run("picture",java.util.Collections.singletonList(picture()));
        assertTrue(f.login); assertFalse(f.ended); assertEquals(3,f.connections.size());
    }
    @Test public void invalidImageNeverStartsNetworkWork() throws Exception {
        Fixture f = new Fixture(); f.client.run("picture",java.util.Collections.singletonList(new DirectWebClient.Image("bad",new byte[]{1,2,3})));
        assertFalse(f.ended); assertTrue(f.error.contains("图片")); assertEquals(0,f.connections.size());
    }
}
