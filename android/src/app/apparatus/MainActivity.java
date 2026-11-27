package app.apparatus;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.HashMap;

/**
 * Hosts the Apparatus web app, bundled in assets/, in a WebView.
 *
 * The app is served from a fixed https origin rather than file:// so its
 * localStorage (program, 1RMs, history) has a stable home across updates.
 */
public class MainActivity extends Activity {
    private static final String HOST = "apparatus.local";
    private static final String START = "https://" + HOST + "/index.html";
    private static final int REQ_PICK = 1;
    private static final int REQ_SAVE = 2;

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String pendingSaveText;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        web.setBackgroundColor(0xff0e0e0e);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);

        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new AssetClient());
        web.setWebChromeClient(new FileChooserClient());
        web.loadUrl(START);
    }

    /** Serves https://apparatus.local/* from the APK's assets. */
    private class AssetClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!HOST.equals(uri.getHost())) return null;
            String path = uri.getPath() == null ? "" : uri.getPath();
            while (path.startsWith("/")) path = path.substring(1);
            if (path.length() == 0) path = "index.html";
            try {
                InputStream in = getAssets().open(path);
                String mime = mimeFor(path);
                return new WebResourceResponse(mime, isText(mime) ? "utf-8" : null, in);
            } catch (IOException e) {
                return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found",
                        new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
            }
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            if (HOST.equals(Uri.parse(url).getHost())) return false;
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
            } catch (ActivityNotFoundException e) {
                // nothing can open it; stay in the app
            }
            return true;
        }
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.equals("application/json") || mime.equals("application/javascript");
    }

    private static String mimeFor(String path) {
        String p = path.toLowerCase();
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".js")) return "application/javascript";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".png")) return "image/png";
        if (p.endsWith(".woff2")) return "font/woff2";
        if (p.endsWith(".csv")) return "text/csv";
        return "application/octet-stream";
    }

    /** Backs the program/backup import box. */
    private class FileChooserClient extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            pick.setType("*/*");
            try {
                startActivityForResult(Intent.createChooser(pick, "Select a file"), REQ_PICK);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                callback.onReceiveValue(null);
            }
            return true;
        }
    }

    /** A WebView can't download a blob link, so exports are saved from here. */
    private class Bridge {
        @JavascriptInterface
        public void saveFile(final String name, final String mime, final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    pendingSaveText = text;
                    Intent save = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    save.addCategory(Intent.CATEGORY_OPENABLE);
                    save.setType(mime == null || mime.length() == 0 ? "text/plain" : mime);
                    save.putExtra(Intent.EXTRA_TITLE, name);
                    try {
                        startActivityForResult(save, REQ_SAVE);
                    } catch (ActivityNotFoundException e) {
                        pendingSaveText = null;
                        Toast.makeText(MainActivity.this, "No app available to save files", Toast.LENGTH_LONG).show();
                    }
                }
            });
        }
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        Uri uri = (result == RESULT_OK && data != null) ? data.getData() : null;
        if (request == REQ_PICK) {
            if (fileCallback != null) fileCallback.onReceiveValue(uri == null ? null : new Uri[] { uri });
            fileCallback = null;
        } else if (request == REQ_SAVE) {
            String text = pendingSaveText;
            pendingSaveText = null;
            if (uri == null || text == null) return;
            try {
                OutputStream out = getContentResolver().openOutputStream(uri);
                try {
                    out.write(text.getBytes("UTF-8"));
                } finally {
                    out.close();
                }
                Toast.makeText(this, "Saved", Toast.LENGTH_SHORT).show();
            } catch (Exception e) {
                Toast.makeText(this, "Could not save the file", Toast.LENGTH_LONG).show();
            }
        }
    }

    /** Back closes the open page inside the app first, then leaves it. */
    @Override
    public void onBackPressed() {
        web.evaluateJavascript("(window.apparatusBack && window.apparatusBack()) ? 1 : 0", new ValueCallback<String>() {
            @Override
            public void onReceiveValue(String closed) {
                if (!"1".equals(closed)) moveTaskToBack(true);
            }
        });
    }
}
