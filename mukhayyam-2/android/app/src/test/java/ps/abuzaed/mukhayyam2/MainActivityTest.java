package ps.abuzaed.mukhayyam2;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

import android.content.Intent;
import android.net.Uri;
import android.webkit.WebView;

import org.junit.Test;
import org.junit.runner.RunWith;
import org.robolectric.Robolectric;
import org.robolectric.RobolectricTestRunner;
import org.robolectric.annotation.Config;
import org.robolectric.shadows.ShadowWebView;
import org.robolectric.android.controller.ActivityController;

import static org.robolectric.Shadows.shadowOf;

/** The app opens, shows the site, and survives the things that used to close it. */
@RunWith(RobolectricTestRunner.class)
@Config(sdk = {24, 28, 33, 34})
public class MainActivityTest {

  @Test
  public void opensAndLoadsTheSite() {
    ActivityController<MainActivity> c = Robolectric.buildActivity(MainActivity.class).create().start().resume();
    MainActivity a = c.get();
    assertFalse(a.isFinishing());
    WebView web = (WebView) ((android.view.ViewGroup) a.findViewById(android.R.id.content)).getChildAt(0);
    assertNotNull(web);
    assertEquals(MainActivity.HOME, shadowOf(web).getLastLoadedUrl());
    assertTrue(web.getSettings().getJavaScriptEnabled());
    assertTrue(web.getSettings().getDomStorageEnabled());
  }

  @Test
  public void aLinkOfTheSiteOpensThatPage_othersOpenHome() {
    Intent mine = new Intent(Intent.ACTION_VIEW, Uri.parse("https://mukhayyam2.pages.dev/t/abc123"));
    assertEquals("https://mukhayyam2.pages.dev/t/abc123", MainActivity.startUrl(mine));
    assertEquals(MainActivity.HOME, MainActivity.startUrl(new Intent(Intent.ACTION_VIEW, Uri.parse("https://evil.example/t/abc"))));
    assertEquals(MainActivity.HOME, MainActivity.startUrl(new Intent(Intent.ACTION_VIEW, Uri.parse("http://mukhayyam2.pages.dev/"))));
    assertEquals(MainActivity.HOME, MainActivity.startUrl(null));
  }

  @Test
  public void survivesRotationAndComingBack() {
    ActivityController<MainActivity> c = Robolectric.buildActivity(MainActivity.class).create().start().resume();
    c.pause().stop();
    c.restart().start().resume();
    assertFalse(c.get().isFinishing());
    c.pause().stop().destroy();
  }
}
