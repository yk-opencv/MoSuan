package cn.mosuan.reader;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.OutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.nio.charset.StandardCharsets;
import android.util.Base64;
import android.content.Context;
import android.print.PrintManager;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.os.Bundle;
import android.print.PageRange;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.os.Handler;
import android.os.Looper;
import java.io.ByteArrayInputStream;

@CapacitorPlugin(name = "MosuanFiles")
public class MosuanFilesPlugin extends Plugin {
    private boolean saving;
    private static final long MAX_BACKUP_BYTES = 64L * 1024 * 1024;
    private WebView printView;
    private PluginCall printCall;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Runnable printTimeout = () -> { if (printCall != null) { printCall.reject("PDF 排版等待超时，请拆分笔记后重试。"); printCall = null; releasePrint(); } };
    private void chooseSave(PluginCall call, String mime) {
        if (saving) { call.reject("已有文件正在保存，请先完成或取消。"); return; }
        saving = true;
        String filename = call.getString("filename", "墨算笔记").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT); intent.addCategory(Intent.CATEGORY_OPENABLE); intent.setType(mime); intent.putExtra(Intent.EXTRA_TITLE, filename);
        try { startActivityForResult(call, intent, "savedDocument"); }
        catch (Exception error) { saving = false; call.reject("未找到系统文件保存界面，请检查文件管理器。"); }
    }
    @PluginMethod
    public void saveText(PluginCall call) {
        String text = call.getString("text");
        if (text == null || text.length() > 15000000) { call.reject("导出内容为空或过大"); return; }
        chooseSave(call, "text/markdown");
    }

    private File backupCache(PluginCall call) {
        String name = call.getString("cacheName", "");
        if (!name.matches("[0-9a-f-]{36}\\.tmp")) throw new IllegalArgumentException("备份文件名无效");
        return new File(new File(getContext().getCacheDir(), "mosuan-backups"), name);
    }

    @PluginMethod
    public void saveBackup(PluginCall call) {
        try {
            File file = backupCache(call);
            if (!file.isFile() || file.length() == 0 || file.length() > MAX_BACKUP_BYTES) {
                call.reject("备份文件为空或超过 64 MiB"); return;
            }
            chooseSave(call, "application/json");
        } catch (Exception error) { call.reject("找不到待保存的备份文件。"); }
    }

    @PluginMethod public void saveBinary(PluginCall call) {
        String data = call.getString("base64"), mime = call.getString("mime", "");
        if (!"application/vnd.openxmlformats-officedocument.wordprocessingml.document".equals(mime) || data == null || data.isEmpty() || data.length() > 40000000 || !data.matches("[A-Za-z0-9+/]+={0,2}")) { call.reject("导出文件格式或大小无效"); return; }
        chooseSave(call, mime);
    }
    private void releasePrint() { handler.removeCallbacks(printTimeout); if (printView != null) { printView.destroy(); printView = null; } }
    @PluginMethod public void printPdf(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.length() > 30000000) { call.reject("PDF 内容为空或过大，请拆分后导出。"); return; }
        getActivity().runOnUiThread(() -> {
            if (printView != null) { call.reject("已有 PDF 正在打印，请先关闭系统打印界面。"); return; }
            try {
                PrintManager manager = (PrintManager)getActivity().getSystemService(Context.PRINT_SERVICE);
                if (manager == null) throw new Exception();
                printCall = call; printView = new WebView(getActivity());
                printView.getSettings().setJavaScriptEnabled(false); printView.getSettings().setAllowFileAccess(false);
                printView.getSettings().setAllowContentAccess(false); printView.getSettings().setBlockNetworkLoads(true);
                printView.setWebViewClient(new WebViewClient() {
                    @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return true; }
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                        if ("data".equals(request.getUrl().getScheme()) || "about".equals(request.getUrl().getScheme())) return null;
                        return new WebResourceResponse("text/plain", "UTF-8", new ByteArrayInputStream(new byte[0]));
                    }
                    @Override public void onPageFinished(WebView view, String url) {
                        if (printCall != call || printView != view) return;
                        handler.removeCallbacks(printTimeout);
                        try {
                            PrintDocumentAdapter delegate = view.createPrintDocumentAdapter(call.getString("title", "墨算笔记"));
                            PrintDocumentAdapter adapter = new PrintDocumentAdapter() {
                                @Override public void onStart() { delegate.onStart(); }
                                @Override public void onLayout(PrintAttributes oldAttrs, PrintAttributes attrs, CancellationSignal cancel, LayoutResultCallback callback, Bundle extras) { delegate.onLayout(oldAttrs, attrs, cancel, callback, extras); }
                                @Override public void onWrite(PageRange[] pages, ParcelFileDescriptor dest, CancellationSignal cancel, WriteResultCallback callback) { delegate.onWrite(pages, dest, cancel, callback); }
                                @Override public void onFinish() { delegate.onFinish(); releasePrint(); }
                            };
                            manager.print(call.getString("title", "墨算笔记"), adapter, new PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).setColorMode(PrintAttributes.COLOR_MODE_COLOR).build());
                            printCall = null; JSObject result = new JSObject(); result.put("opened", true); call.resolve(result);
                        } catch (Exception error) { printCall = null; releasePrint(); call.reject("无法打开系统打印，请检查手机打印服务。"); }
                    }
                });
                handler.postDelayed(printTimeout, 30000); printView.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception error) { printCall = null; releasePrint(); call.reject("PDF 排版启动失败，请检查 Android System WebView。"); }
        });
    }

    @ActivityCallback
    private void savedDocument(PluginCall call, ActivityResult result) {
        saving = false;
        if (call == null) return;
        JSObject response = new JSObject();
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            response.put("cancelled", true); call.resolve(response); return;
        }
        Uri uri = result.getData().getData();
        getBridge().execute(() -> {
            try (OutputStream output = getContext().getContentResolver().openOutputStream(uri, "wt")) {
                if (output == null) throw new IllegalStateException("无法打开保存位置");
                if ("saveBackup".equals(call.getMethodName())) {
                    File file = backupCache(call);
                    if (!file.isFile() || file.length() > MAX_BACKUP_BYTES) throw new IllegalStateException("备份文件不可读");
                    try (FileInputStream input = new FileInputStream(file)) {
                        byte[] buffer = new byte[64 * 1024];
                        for (int length; (length = input.read(buffer)) != -1;) output.write(buffer, 0, length);
                    }
                } else {
                    byte[] bytes = "saveBinary".equals(call.getMethodName()) ? Base64.decode(call.getString("base64", ""), Base64.DEFAULT) : call.getString("text", "").getBytes(StandardCharsets.UTF_8);
                    output.write(bytes);
                }
            } catch (Exception error) { call.reject("文件保存失败，请重新选择保存位置"); return; }
            response.put("uri", uri.toString()); call.resolve(response);
        });
    }
    @Override protected void handleOnDestroy() { getActivity().runOnUiThread(() -> { if (printCall != null) printCall.reject("页面已关闭，导出取消。"); printCall = null; releasePrint(); }); }
}
