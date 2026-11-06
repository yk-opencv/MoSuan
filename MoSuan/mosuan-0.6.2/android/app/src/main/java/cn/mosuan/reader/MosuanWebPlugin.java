package cn.mosuan.reader;

import android.app.Dialog;
import android.content.Context;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import org.json.JSONObject;
import org.json.JSONArray;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "MosuanWeb")
public class MosuanWebPlugin extends Plugin {
    private final ExecutorService requests = Executors.newSingleThreadExecutor();
    private final LinkedHashSet<String> cancelledIds = new LinkedHashSet<>();
    private volatile DirectWebClient active;
    private volatile String activeId;
    private Dialog loginDialog;
    private WebView loginWeb;
    private TextView loginHint;
    private PluginCall loginCall;
    private boolean saveRequested;
    private WebAuthStore store() { return new WebAuthStore(getContext()); }
    private boolean available() { return WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER) && WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT); }
    private boolean ready() { try { return store().load() != null; } catch (Exception error) { return false; } }
    @PluginMethod public void status(PluginCall call) {
        JSObject value = new JSObject(); value.put("available", available()); value.put("ready", ready()); value.put("direct", true); call.resolve(value);
    }
    @PluginMethod public void open(PluginCall call) { getActivity().runOnUiThread(() -> showLogin(call)); }
    @PluginMethod public void forget(PluginCall call) { store().clear(); call.resolve(); }
    @PluginMethod public synchronized void ask(PluginCall call) {
        final String id = call.getString("id"), prompt = call.getString("prompt");
        if (id == null || !id.matches("[a-zA-Z0-9_-]{1,100}") || prompt == null || prompt.trim().isEmpty() || prompt.length() > 28000) { call.reject("问题格式或长度无效"); return; }
        if (cancelledIds.remove(id)) { call.reject("请求已停止"); return; }
        if (active != null) { call.reject("已有问题正在回答，请先停止或等待完成。"); return; }
        final List<DirectWebClient.Image> images = new ArrayList<>();
        try {
            JSONArray values = call.getData().optJSONArray("images");
            if (values != null) {
                if (values.length() > 10) throw new Exception();
                int total = 0;
                for (int i = 0; i < values.length(); i++) {
                    JSONObject value = values.getJSONObject(i); String url = value.getString("dataUrl");
                    total += url.length();
                    if (total > 6000000 || url.length() > 750000 || !url.matches("data:image/jpeg;base64,[A-Za-z0-9+/]+={0,2}")) throw new Exception();
                    images.add(new DirectWebClient.Image(value.optString("name", "图片"), Base64.decode(url.substring(url.indexOf(',') + 1), Base64.DEFAULT)));
                }
            }
        } catch (Exception error) { call.reject("图片数据无效，请移除后重新选择。"); return; }
        final JSONObject auth;
        try { auth = store().load(); if (auth == null) throw new Exception(); }
        catch (Exception error) { call.reject("请先在手机登录 DeepSeek，并点击“保存登录并返回”。"); return; }
        activeId = id;
        active = new DirectWebClient(auth, new DirectWebClient.Listener() {
            @Override public void progress(String message) { emit(id, new JSObject().put("kind", "progress").put("message", message)); }
            @Override public void proof(JSONObject challenge, String wasm) { emit(id, new JSObject().put("kind", "proof").put("challenge", challenge).put("wasm", wasm)); }
            @Override public void chunk(String text) { emit(id, new JSObject().put("kind", "raw").put("content", text)); }
            @Override public void end() { emit(id, new JSObject().put("kind", "end")); finished(id); }
            @Override public void failure(String message, boolean login) {
                if (login) store().clear();
                emit(id, new JSObject().put("kind", "error").put("message", message)); finished(id);
            }
        }, value -> Base64.encodeToString(value, Base64.NO_WRAP));
        final DirectWebClient request = active;
        requests.execute(() -> request.run(prompt, images)); call.resolve();
    }
    private synchronized void finished(String id) { if (id.equals(activeId)) { active = null; activeId = null; } }
    private void emit(String id, JSObject value) { if (!id.equals(activeId)) return; value.put("id", id); notifyListeners("webEvent", value); }
    @PluginMethod public synchronized void proof(PluginCall call) {
        if (active != null && activeId.equals(call.getString("id"))) {
            Object numeric = call.getData().opt("answer");
            Double answer = numeric instanceof Number ? ((Number)numeric).doubleValue() : null;
            active.solved(answer != null && Double.isFinite(answer) && answer == Math.rint(answer) && answer > 0 && answer <= 9007199254740991d ? answer.longValue() : -1, call.getString("error"));
        }
        call.resolve();
    }
    @PluginMethod public synchronized void cancel(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.isEmpty()) { cancelledIds.add(id); if (cancelledIds.size() > 64) cancelledIds.remove(cancelledIds.iterator().next()); }
        if (id.equals(activeId) && active != null) { active.cancel(); active = null; activeId = null; }
        call.resolve();
    }
    private int dp(int value) { return Math.round(value * getContext().getResources().getDisplayMetrics().density); }
    private void button(String label, LinearLayout row, Runnable action) {
        Button button = new Button(getActivity()); button.setAllCaps(false); button.setText(label); button.setTextSize(12); button.setMinWidth(0);
        row.addView(button, new LinearLayout.LayoutParams(0, dp(50), 1)); button.setOnClickListener(view -> action.run());
    }
    private void showLogin(PluginCall call) {
        if (loginDialog != null) { call.reject("登录页已打开"); return; }
        if (!available()) { call.reject("请先更新 Android System WebView 后重试。"); return; }
        final String script;
        try (InputStream input = getContext().getAssets().open("phone-auth.js"); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192]; int length; while ((length = input.read(buffer)) != -1) output.write(buffer, 0, length);
            script = new String(output.toByteArray(), StandardCharsets.UTF_8);
        } catch (Exception error) { call.reject("登录组件未完整安装，请更新墨算。"); return; }
        loginCall = call; saveRequested = false;
        loginDialog = new Dialog(getActivity(), R.style.MosuanWebDialog); loginDialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        LinearLayout root = new LinearLayout(getActivity()); root.setOrientation(LinearLayout.VERTICAL); root.setFitsSystemWindows(true); root.setBackgroundColor(Color.rgb(255,254,250));
        LinearLayout actions = new LinearLayout(getActivity()); root.addView(actions);
        button("返回墨算", actions, () -> loginDialog.dismiss());
        button("保存登录并返回", actions, () -> { saveRequested = true; if (loginWeb != null) loginWeb.evaluateJavascript("window.MosuanAuth&&window.MosuanAuth.save()", null); });
        button("刷新网页", actions, () -> { if (loginWeb != null) loginWeb.reload(); });
        loginHint = new TextView(getActivity()); loginHint.setTextSize(12); loginHint.setPadding(dp(12), dp(6), dp(12), dp(10));
        loginHint.setText("请登录自己的 DeepSeek 账号，再点击“保存登录并返回”。仅保存到手机加密存储；以后提问直接在墨算完成。"); root.addView(loginHint);
        loginWeb = new WebView(getActivity()); root.addView(loginWeb, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        WebSettings settings = loginWeb.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true); settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        CookieManager.getInstance().setAcceptCookie(true); loginWeb.setWebChromeClient(new WebChromeClient());
        WebViewCompat.addWebMessageListener(loginWeb, "MosuanAuthChannel", Collections.singleton(DirectWebClient.ORIGIN), (view, message, origin, mainFrame, reply) -> {
            if (view != loginWeb || !mainFrame || !DirectWebClient.ORIGIN.equals(origin.toString()) || !saveRequested) return;
            try {
                String raw = message.getData(); if (raw == null || raw.length() > 50000) return;
                JSONObject data = new JSONObject(raw);
                if (!"credentials".equals(data.optString("kind"))) { loginHint.setText("尚未找到有效登录。请完成登录，等待页面加载后再保存。"); return; }
                JSONObject auth = data.getJSONObject("auth");
                String token = DirectWebClient.header(auth.optString("token")).replaceFirst("(?i)^Bearer\\s+", "");
                String cookie = CookieManager.getInstance().getCookie(DirectWebClient.ORIGIN);
                if (token.length() < 20 || token.length() > 8192 || cookie == null || cookie.isEmpty()) { loginHint.setText("登录信息尚未就绪，请完成登录并等待网页加载；必要时在网页发送一句测试后再保存。"); return; }
                auth.put("token", token); auth.put("cookie", DirectWebClient.header(cookie)); auth.put("userAgent", DirectWebClient.header(settings.getUserAgentString()));
                if (!DirectWebClient.validWasm(auth.optString("wasmUrl"))) auth.put("wasmUrl", DirectWebClient.DEFAULT_WASM);
                store().save(auth); CookieManager.getInstance().flush(); saveRequested = false; loginDialog.dismiss();
            } catch (Exception error) { loginHint.setText("登录保存失败，请重新登录后重试；没有把登录信息发送到电脑。"); }
        });
        WebViewCompat.addDocumentStartJavaScript(loginWeb, script, Collections.singleton(DirectWebClient.ORIGIN));
        loginWeb.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl(); if ("https".equals(uri.getScheme()) && "chat.deepseek.com".equals(uri.getHost())) return false;
                if (request.isForMainFrame() && request.hasGesture() && "https".equals(uri.getScheme())) try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                return true;
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) { if (request.isForMainFrame()) loginHint.setText("无法打开 DeepSeek 登录页，请检查手机网络后刷新。"); }
        });
        loginDialog.setContentView(root); loginDialog.setOnDismissListener(value -> {
            CookieManager.getInstance().flush(); if (loginWeb != null) { loginWeb.stopLoading(); loginWeb.destroy(); loginWeb = null; }
            loginDialog = null; saveRequested = false;
            if (loginCall != null) { loginCall.resolve(); loginCall = null; }
        });
        loginDialog.show(); Window window = loginDialog.getWindow();
        if (window != null) { window.setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT); window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE); }
        loginWeb.loadUrl(DirectWebClient.ORIGIN + "/");
    }
    @Override protected void handleOnDestroy() { DirectWebClient request = active; if (request != null) request.cancel(); requests.shutdownNow(); if (loginDialog != null) getActivity().runOnUiThread(() -> { if (loginDialog != null) loginDialog.dismiss(); }); }
}
