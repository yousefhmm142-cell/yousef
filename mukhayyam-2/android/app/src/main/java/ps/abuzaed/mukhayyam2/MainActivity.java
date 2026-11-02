package ps.abuzaed.mukhayyam2;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.util.Base64;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.OutputStream;

/**
 * Mukhayyam 2 on the phone: a full-screen window on https://mukhayyam2.pages.dev.
 * The site keeps itself (and the day's forms) on the device, so it also works without internet.
 *
 * Everything risky is wrapped: if the web engine cannot start at all, the site opens in the
 * browser instead of the app closing.
 */
public class MainActivity extends Activity {
  static final String HOST = "mukhayyam2.pages.dev";
  static final String HOME = "https://" + HOST + "/";
  private static final int REQ_FILE = 71;
  private static final int REQ_SAVE = 72;

  private WebView web;
  private ValueCallback<Uri[]> chooser;
  private byte[] pendingSave;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    try {
      web = new WebView(this);
      web.setLayoutParams(new ViewGroup.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
      setContentView(web);
      configure(web);
      if (state == null || web.restoreState(state) == null) {
        web.loadUrl(startUrl(getIntent()));
      }
    } catch (Throwable t) {
      // No usable web engine (being updated, disabled...): the browser is the next best thing.
      openOutside(Uri.parse(HOME));
      finish();
    }
  }

  @Override
  protected void onNewIntent(Intent intent) {
    super.onNewIntent(intent);
    setIntent(intent);
    if (web != null && intent != null && intent.getData() != null) {
      web.loadUrl(startUrl(intent));
    }
  }

  /** The page to open: a link of the site when the app was opened by one, else the home page. */
  static String startUrl(Intent intent) {
    Uri data = intent == null ? null : intent.getData();
    if (data != null && "https".equalsIgnoreCase(data.getScheme()) && HOST.equalsIgnoreCase(data.getHost())) {
      return data.toString();
    }
    return HOME;
  }

  private void configure(WebView view) {
    WebSettings s = view.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true); // the forms and lists kept on the device (works without internet)
    s.setDatabaseEnabled(true);
    s.setAllowFileAccess(false);
    s.setAllowContentAccess(false);
    s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
    s.setSupportMultipleWindows(false);
    s.setBuiltInZoomControls(false);
    s.setUserAgentString(s.getUserAgentString() + " Mukhayyam2App/2.0");
    CookieManager cm = CookieManager.getInstance();
    cm.setAcceptCookie(true);
    cm.setAcceptThirdPartyCookies(view, false);
    view.addJavascriptInterface(new Bridge(), "M2Android");

    view.setWebViewClient(new WebViewClient() {
      @Override
      public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
        return !stays(r.getUrl());
      }

      @Override
      public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
        // Only the page itself: a missing picture should not replace it.
        if (r.isForMainFrame()) {
          v.loadDataWithBaseURL(HOME, OFFLINE_PAGE, "text/html", "utf-8", null);
        }
      }

      @Override
      public void onPageFinished(WebView v, String url) {
        // «طباعة» inside the site opens Android's print window.
        v.evaluateJavascript("window.print=function(){try{M2Android.print()}catch(e){}};", null);
      }

      @Override
      public boolean onRenderProcessGone(WebView v, RenderProcessGoneDetail d) {
        // The web engine's process died (memory): start over instead of closing.
        recreate();
        return true;
      }
    });

    view.setWebChromeClient(new WebChromeClient() {
      @Override
      public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> callback, FileChooserParams params) {
        if (chooser != null) chooser.onReceiveValue(null);
        chooser = callback;
        try {
          startActivityForResult(params.createIntent(), REQ_FILE);
        } catch (Throwable t) {
          chooser = null;
          return false;
        }
        return true;
      }
    });

    // A file offered by link: the browser takes it.
    view.setDownloadListener((url, ua, cd, mime, len) -> openOutside(Uri.parse(url)));
  }

  /** Our own pages stay in the app; everything else goes to the apps made for it. */
  private boolean stays(Uri u) {
    if ("https".equalsIgnoreCase(u.getScheme()) && HOST.equalsIgnoreCase(u.getHost())) return true;
    if ("about".equalsIgnoreCase(u.getScheme()) || "data".equalsIgnoreCase(u.getScheme()) || "blob".equalsIgnoreCase(u.getScheme())) return true;
    openOutside(u);
    return false;
  }

  private void openOutside(Uri u) {
    try {
      startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    } catch (ActivityNotFoundException ignored) {
      // Nothing on this phone opens it.
    }
  }

  /** What the site can ask of the phone: save a file, print. Only our own pages ever load here. */
  private class Bridge {
    @JavascriptInterface
    public void saveFile(String name, String mime, String base64) {
      final byte[] bytes;
      try {
        bytes = Base64.decode(base64, Base64.DEFAULT);
      } catch (IllegalArgumentException e) {
        return;
      }
      final String type = (mime == null || mime.isEmpty()) ? "application/octet-stream" : mime;
      final String title = (name == null || name.isEmpty()) ? "mukhayyam2" : name;
      runOnUiThread(() -> {
        pendingSave = bytes;
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType(type).putExtra(Intent.EXTRA_TITLE, title);
        try {
          startActivityForResult(i, REQ_SAVE);
        } catch (Throwable t) {
          pendingSave = null;
          Toast.makeText(MainActivity.this, "تعذّر حفظ الملف", Toast.LENGTH_SHORT).show();
        }
      });
    }

    @JavascriptInterface
    public void print() {
      runOnUiThread(() -> {
        try {
          PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
          if (pm != null && web != null) {
            pm.print("مخيم 2", web.createPrintDocumentAdapter("مخيم 2"), new PrintAttributes.Builder().build());
          }
        } catch (Throwable ignored) {
          // No print service on this phone.
        }
      });
    }
  }

  @Override
  protected void onActivityResult(int request, int result, Intent data) {
    super.onActivityResult(request, result, data);
    if (request == REQ_FILE && chooser != null) {
      chooser.onReceiveValue(result == RESULT_OK ? WebChromeClient.FileChooserParams.parseResult(result, data) : null);
      chooser = null;
    } else if (request == REQ_SAVE && pendingSave != null) {
      byte[] bytes = pendingSave;
      pendingSave = null;
      if (result == RESULT_OK && data != null && data.getData() != null) {
        try (OutputStream out = getContentResolver().openOutputStream(data.getData())) {
          if (out != null) out.write(bytes);
          Toast.makeText(this, "حُفظ الملف", Toast.LENGTH_SHORT).show();
        } catch (Throwable t) {
          Toast.makeText(this, "تعذّر حفظ الملف", Toast.LENGTH_SHORT).show();
        }
      }
    }
  }

  @Override
  protected void onSaveInstanceState(Bundle out) {
    super.onSaveInstanceState(out);
    if (web != null) web.saveState(out);
  }

  @Override
  protected void onResume() {
    super.onResume();
    if (web != null) web.onResume();
  }

  @Override
  protected void onPause() {
    if (web != null) {
      web.onPause();
      CookieManager.getInstance().flush();
    }
    super.onPause();
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }

  @Override
  protected void onDestroy() {
    if (web != null) {
      ((ViewGroup) web.getParent()).removeView(web);
      web.destroy();
      web = null;
    }
    super.onDestroy();
  }

  private static final String OFFLINE_PAGE =
      "<!doctype html><html lang='ar' dir='rtl'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>"
          + "<style>body{font-family:sans-serif;background:#F4F1EC;color:#1b1b1b;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center}"
          + "div{padding:24px}h2{margin:0 0 8px}p{color:#666;line-height:1.7}a{display:inline-block;margin-top:14px;padding:12px 28px;border-radius:99px;background:#8E1B2B;color:#fff;text-decoration:none;font-weight:700}</style></head>"
          + "<body><div><h2>مخيم 2</h2><p>لا يوجد اتصال بالإنترنت الآن.<br>أول مرة تحتاج الإنترنت لتفتح النظام، وبعدها يشتغل بدونه.</p><a href='" + HOME + "'>إعادة المحاولة</a></div></body></html>";
}
