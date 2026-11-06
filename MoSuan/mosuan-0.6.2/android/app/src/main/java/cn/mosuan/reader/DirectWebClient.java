package cn.mosuan.reader;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.List;
import java.util.ArrayList;
import java.util.UUID;
import java.io.OutputStream;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.json.JSONArray;
import org.json.JSONObject;

/** A single cancellable request, with no retry, UI automation or paid fallback. */
final class DirectWebClient {
    static final String ORIGIN = "https://chat.deepseek.com";
    static final String COMPLETION = "/api/v0/chat/completion";
    static final String UPLOAD = "/api/v0/file/upload_file";
    static final class Image {
        final String name; final byte[] bytes;
        Image(String name, byte[] bytes) { this.name = name; this.bytes = bytes; }
    }
    static final String DEFAULT_WASM = "https://fe-static.deepseek.com/chat/static/sha3_wasm_bg.7b9ca65ddd.wasm";
    interface Transport { HttpURLConnection open(URL url) throws Exception; }
    interface Codec { String base64(byte[] value); }
    interface Listener {
        void progress(String message);
        void proof(JSONObject challenge, String wasm);
        void chunk(String text);
        void end();
        void failure(String message, boolean loginRequired);
    }
    private final JSONObject auth;
    private final Listener listener;
    private final Transport transport;
    private final Codec codec;
    private volatile CompletableFuture<Long> solution = new CompletableFuture<>();
    private volatile boolean cancelled;
    private volatile HttpURLConnection current;
    DirectWebClient(JSONObject auth, Listener listener, Codec codec) { this(auth, listener, codec, url -> (HttpURLConnection)url.openConnection()); }
    DirectWebClient(JSONObject auth, Listener listener, Codec codec, Transport transport) { this.auth = auth; this.listener = listener; this.codec = codec; this.transport = transport; }
    void cancel() { cancelled = true; solution.cancel(true); HttpURLConnection connection = current; if (connection != null) connection.disconnect(); }
    void solved(long answer, String error) { if (answer > 0 && error == null) solution.complete(answer); else solution.completeExceptionally(new Exception("PoW 计算失败，请检查手机 WebView 后重试。")); }
    private void check() throws Exception { if (cancelled || Thread.currentThread().isInterrupted()) throw new InterruptedException(); }
    static boolean validWasm(String value) {
        try { URL url = new URL(value); return "https".equals(url.getProtocol()) && "fe-static.deepseek.com".equals(url.getHost()) && (url.getPort() == -1 || url.getPort() == 443) && url.getUserInfo() == null && url.getQuery() == null && url.getRef() == null && url.getPath().endsWith(".wasm"); }
        catch (Exception error) { return false; }
    }
    static String header(String value) throws Exception {
        if (value == null || value.length() > 20000 || value.indexOf('\r') >= 0 || value.indexOf('\n') >= 0 || value.indexOf(0) >= 0) throw new Exception("登录字段格式无效，请重新登录。");
        return value.trim();
    }
    private Map<String,String> headers() throws Exception {
        Map<String,String> result = new LinkedHashMap<>();
        result.put("Authorization", "Bearer " + header(auth.getString("token")));
        result.put("Cookie", header(auth.optString("cookie")));
        result.put("User-Agent", header(auth.optString("userAgent", "Mozilla/5.0")));
        result.put("Origin", ORIGIN); result.put("Referer", ORIGIN + "/");
        result.put("Content-Type", "application/json"); result.put("Accept", "application/json, text/event-stream");
        result.put("x-client-platform", "web"); result.put("x-client-version", "2.0.2"); result.put("x-app-version", "2.0.2"); result.put("x-client-locale", "zh_CN");
        JSONObject captured = auth.optJSONObject("headers");
        if (captured != null) for (String name : new String[]{"x-hif-dliq", "x-hif-leim", "x-client-platform", "x-client-version", "x-app-version", "x-client-locale", "x-client-timezone-offset"}) {
            if (captured.has(name)) result.put(name, header(captured.optString(name)));
        }
        return result;
    }
    private HttpURLConnection post(String path, JSONObject body, String pow) throws Exception {
        check();
        if (!path.equals(COMPLETION) && !path.equals("/api/v0/chat/create_pow_challenge") && !path.equals("/api/v0/chat_session/create")) throw new Exception("不支持的网页接口");
        HttpURLConnection connection = transport.open(new URL(ORIGIN + path)); current = connection;
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(120000);
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        for (Map.Entry<String,String> entry : headers().entrySet()) if (!entry.getValue().isEmpty()) connection.setRequestProperty(entry.getKey(), entry.getValue());
        if (pow != null) connection.setRequestProperty("X-DS-PoW-Response", pow);
        byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8); connection.setFixedLengthStreamingMode(bytes.length);
        try (java.io.OutputStream output = connection.getOutputStream()) { output.write(bytes); }
        return connection;
    }
    private String read(InputStream input, int limit) throws Exception {
        if (input == null) return "";
        try (InputStream stream = input; ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
            byte[] block = new byte[4096]; int size;
            while ((size = stream.read(block)) != -1) { check(); if (bytes.size() + size > limit) throw new Exception("网页响应过大"); bytes.write(block, 0, size); }
            return new String(bytes.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    private static final class ServiceError extends Exception {
        final boolean loginRequired;
        ServiceError(String message, boolean login) { super(message); loginRequired = login; }
    }
    private void failure(int status, JSONObject body) throws Exception {
        int code = body == null ? 0 : body.optInt("code");
        JSONObject data = body == null ? null : body.optJSONObject("data");
        int business = data == null ? 0 : data.optInt("biz_code");
        String message = body == null ? "" : body.optString("msg") + " " + (data == null ? "" : data.optString("biz_msg"));
        if (status == 429 || code == 40029 || business == 40029 || message.contains("TOO_MANY_REQUESTS")) throw new ServiceError("网页版请求过于频繁，请稍后重试。", false);
        if (status == 401 || status == 403 || code >= 40001 && code <= 40003) throw new ServiceError("网页登录已失效或需要验证，请在手机重新登录并保存登录。", true);
        if (status < 200 || status >= 300 || code != 0 || business != 0 || body != null && body.has("error")) throw new ServiceError("网页版接口未接受请求，请检查手机登录和网页服务后重试。", false);
    }
    private JSONObject json(HttpURLConnection connection) throws Exception {
        try {
            int status = connection.getResponseCode(); String text = read(status >= 400 ? connection.getErrorStream() : connection.getInputStream(), 500000);
            JSONObject value = null; try { value = new JSONObject(text); } catch (Exception ignored) {}
            failure(status, value);
            if (value == null) throw new ServiceError("网页版返回了验证页面或异常内容，请重新打开登录页检查。", true);
            return value;
        } finally { connection.disconnect(); current = null; }
    }
    private byte[] wasm(String address) throws Exception {
        check(); if (!validWasm(address)) throw new Exception("PoW 模块地址无效，请重新保存登录。");
        HttpURLConnection connection = transport.open(new URL(address)); current = connection;
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(20000);
        try {
            if (connection.getResponseCode() != 200) throw new Exception("无法下载官方 PoW 模块，请检查手机网络。");
            try (InputStream stream = connection.getInputStream(); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] block = new byte[4096]; int size;
                while ((size = stream.read(block)) != -1) { check(); if (bytes.size() + size > 2000000) throw new Exception("PoW 模块过大"); bytes.write(block, 0, size); }
                byte[] result = bytes.toByteArray();
                if (result.length < 8 || result[0] != 0 || result[1] != 97 || result[2] != 115 || result[3] != 109) throw new Exception("PoW 模块格式无效");
                return result;
            }
        } finally { connection.disconnect(); current = null; }
    }
    private String createProof(String target) throws Exception {
            check(); solution = new CompletableFuture<>(); listener.progress("正在获取网页请求校验…");
            JSONObject challengeData = json(post("/api/v0/chat/create_pow_challenge", new JSONObject().put("target_path", target), null));
            JSONObject challenge = challengeData.getJSONObject("data").getJSONObject("biz_data").getJSONObject("challenge");
            if (!"DeepSeekHashV1".equals(challenge.optString("algorithm"))) throw new Exception("网页校验协议已变化，需要更新墨算。");
            listener.progress("正在计算网页请求校验…");
            byte[] module = wasm(auth.optString("wasmUrl", DEFAULT_WASM)); check();
            listener.proof(challenge, codec.base64(module));
            long answer = solution.get(40, TimeUnit.SECONDS); check();
            return codec.base64(new JSONObject().put("algorithm", challenge.getString("algorithm")).put("challenge", challenge.getString("challenge"))
                .put("salt", challenge.getString("salt")).put("answer", answer).put("signature", challenge.getString("signature")).put("target_path", target).toString().getBytes(StandardCharsets.UTF_8));
    }
    private String upload(Image image, int number, int total) throws Exception {
        String proof = createProof(UPLOAD); check(); listener.progress("正在上传图片 " + number + " / " + total + "…");
        String boundary = "Mosuan-" + UUID.randomUUID();
        byte[] start = ("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\"image-" + number + ".jpg\"\r\nContent-Type: image/jpeg\r\n\r\n").getBytes(StandardCharsets.UTF_8);
        byte[] end = ("\r\n--" + boundary + "--\r\n").getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection = transport.open(new URL(ORIGIN + UPLOAD)); current = connection;
        connection.setInstanceFollowRedirects(false); connection.setConnectTimeout(20000); connection.setReadTimeout(120000);
        connection.setRequestMethod("POST"); connection.setDoOutput(true);
        for (Map.Entry<String,String> entry : headers().entrySet()) if (!entry.getValue().isEmpty()) connection.setRequestProperty(entry.getKey(), entry.getValue());
        connection.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
        connection.setRequestProperty("X-DS-PoW-Response", proof); connection.setRequestProperty("x-thinking-enabled", "0");
        connection.setRequestProperty("x-model-type", "default"); connection.setRequestProperty("x-file-size", String.valueOf(image.bytes.length));
        connection.setFixedLengthStreamingMode(start.length + image.bytes.length + end.length);
        try (OutputStream output = connection.getOutputStream()) { output.write(start); check(); output.write(image.bytes); output.write(end); }
        JSONObject file = json(connection).getJSONObject("data").getJSONObject("biz_data");
        String id = file.optString("id");
        if (!id.matches("[A-Za-z0-9_-]{1,200}")) throw new ServiceError("图片上传未返回有效文件编号，请重新发送。", false);
        long deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(30);
        while (!"SUCCESS".equals(file.optString("status"))) {
            check(); String status = file.optString("status");
            if (java.util.Arrays.asList("FAILED", "CONTENT_FILTER", "CONTENT_TOO_LONG", "CANCELLED", "CONTENT_EMPTY", "_CUSTOM_SYSTEM_ERROR_FAIL", "_CUSTOM_FROM_SHARE").contains(status)) throw new ServiceError("DeepSeek 未能解析图片，请换一张清晰图片后重试。", false);
            if (System.nanoTime() > deadline) throw new ServiceError("图片解析等待超时，请稍后重新发送。", false);
            listener.progress("正在等待图片 " + number + " / " + total + " 解析…"); Thread.sleep(250); check();
            HttpURLConnection fetch = transport.open(new URL(ORIGIN + "/api/v0/file/fetch_files?file_ids=" + id)); current = fetch;
            fetch.setInstanceFollowRedirects(false); fetch.setConnectTimeout(20000); fetch.setReadTimeout(20000); fetch.setRequestMethod("GET");
            for (Map.Entry<String,String> entry : headers().entrySet()) if (!entry.getValue().isEmpty()) fetch.setRequestProperty(entry.getKey(), entry.getValue());
            JSONArray files = json(fetch).getJSONObject("data").getJSONObject("biz_data").getJSONArray("files");
            for (int i = 0; i < files.length(); i++) if (id.equals(files.getJSONObject(i).optString("id"))) file = files.getJSONObject(i);
        }
        return id;
    }
    void run(String prompt) { run(prompt, new ArrayList<>()); }
    void run(String prompt, List<Image> images) {
        try {
            check(); int bytes = 0;
            if (images.size() > 10) throw new ServiceError("本次问题和历史最多包含 10 张图片。", false);
            for (Image image : images) {
                bytes += image.bytes.length;
                if (image.bytes.length < 3 || image.bytes.length > 562500 || (image.bytes[0] & 255) != 255 || (image.bytes[1] & 255) != 216 || bytes > 4500000) throw new ServiceError("图片数据或大小无效，请重新选择图片。", false);
            }
            JSONArray fileIds = new JSONArray();
            for (int i = 0; i < images.size(); i++) fileIds.put(upload(images.get(i), i + 1, images.size()));
            String pow = createProof(COMPLETION);
            listener.progress("正在创建独立对话…");
            JSONObject session = json(post("/api/v0/chat_session/create", new JSONObject(), null)).getJSONObject("data").getJSONObject("biz_data");
            String sessionId = session.optJSONObject("chat_session") == null ? session.optString("id") : session.getJSONObject("chat_session").optString("id");
            if (sessionId.isEmpty() || sessionId.length() > 200) throw new Exception("网页未返回有效会话，请重新登录后重试。");
            check(); listener.progress("正在接收 DeepSeek 回答…");
            JSONObject body = new JSONObject().put("chat_session_id", sessionId).put("parent_message_id", JSONObject.NULL).put("model_type", "default")
                .put("prompt", prompt).put("ref_file_ids", fileIds).put("thinking_enabled", false).put("search_enabled", false).put("action", JSONObject.NULL).put("preempt", false);
            HttpURLConnection connection = post(COMPLETION, body, pow);
            try {
                String contentType = connection.getContentType();
                if (connection.getResponseCode() != 200 || contentType == null || !contentType.toLowerCase(java.util.Locale.ROOT).contains("text/event-stream")) { json(connection); throw new ServiceError("网页版没有返回回答流，请检查登录或验证提示。", false); }
                try (BufferedReader reader = new BufferedReader(new InputStreamReader(connection.getInputStream(), StandardCharsets.UTF_8))) {
                    int total = 0; String line;
                    while ((line = reader.readLine()) != null) { check(); total += line.length(); if (total > 5000000) throw new Exception("本次回答过长，已保留收到的内容。"); listener.chunk(line + "\n"); }
                }
                check(); listener.end();
            } finally { connection.disconnect(); current = null; }
        } catch (Exception error) {
            if (!cancelled) listener.failure(error instanceof ServiceError ? error.getMessage() : "手机网页接口连接未完成，已保留收到的内容。请检查手机网络、登录或请求校验后重试。", error instanceof ServiceError && ((ServiceError)error).loginRequired);
        } finally { HttpURLConnection connection = current; if (connection != null) connection.disconnect(); current = null; }
    }
}
