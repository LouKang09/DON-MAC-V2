package com.donmacchiatos.pos;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.provider.MediaStore;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.ValueCallback;
import android.widget.FrameLayout;
import android.widget.Toast;

import androidx.core.content.FileProvider;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Don Mac POS is the same tenant-scoped website as the browser version.
 * The native shell is deliberately not a second POS database or a separate
 * attendance system. User login, workspace ID, assigned branch, payroll plan,
 * and server-side authorization all come from https://donmacpos.com.
 */
public final class MainActivity extends Activity {
    private static final String HOME = "https://donmacpos.com/";
    private static final int FILE_REQUEST = 4001;
    private WebView webView;
    private ValueCallback<Uri[]> pendingFileUpload;
    private Uri cameraOutput;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(Color.rgb(9, 64, 37));
        getWindow().setNavigationBarColor(Color.rgb(9, 64, 37));

        webView = new WebView(this);
        FrameLayout holder = new FrameLayout(this);
        holder.setBackgroundColor(Color.rgb(245, 245, 243));
        holder.addView(webView, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(holder);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(true);
        settings.setJavaScriptCanOpenWindowsAutomatically(false);
        settings.setSupportMultipleWindows(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setMediaPlaybackRequiresUserGesture(true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            settings.setSafeBrowsingEnabled(true);
        }
        settings.setUserAgentString(settings.getUserAgentString() + " DonMacAndroidPOS/1.0.0");
        WebView.setWebContentsDebuggingEnabled(false);

        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return openExternalIfNeeded(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return openExternalIfNeeded(Uri.parse(url));
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) {
                    new AlertDialog.Builder(MainActivity.this)
                        .setTitle("Cannot load Don Mac POS")
                        .setMessage("Please connect to the internet and retry. No employee attendance or sale was submitted while the site was unavailable.")
                        .setPositiveButton("Retry", (dialog, which) -> webView.loadUrl(HOME))
                        .setNegativeButton("Close", (dialog, which) -> finish())
                        .show();
                }
            }
        });
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                             FileChooserParams chooserParams) {
                if (pendingFileUpload != null) pendingFileUpload.onReceiveValue(null);
                pendingFileUpload = callback;
                cameraOutput = null;
                try {
                    Intent files = chooserParams.createIntent();
                    files.addCategory(Intent.CATEGORY_OPENABLE);
                    ArrayList<Intent> cameraIntents = new ArrayList<>();
                    if (acceptsImage(chooserParams)) {
                        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
                        if (camera.resolveActivity(getPackageManager()) != null) {
                            File output = File.createTempFile("donmac_receipt_", ".jpg", getCacheDir());
                            cameraOutput = FileProvider.getUriForFile(MainActivity.this,
                                    getPackageName() + ".photos", output);
                            camera.putExtra(MediaStore.EXTRA_OUTPUT, cameraOutput);
                            camera.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION |
                                            Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
                            cameraIntents.add(camera);
                        }
                    }
                    Intent chooser = Intent.createChooser(files, "Choose or capture image");
                    if (!cameraIntents.isEmpty()) {
                        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS,
                                cameraIntents.toArray(new Intent[0]));
                    }
                    startActivityForResult(chooser, FILE_REQUEST);
                    return true;
                } catch (ActivityNotFoundException | IOException e) {
                    pendingFileUpload.onReceiveValue(null);
                    pendingFileUpload = null;
                    Toast.makeText(MainActivity.this, "File upload is unavailable on this device.", Toast.LENGTH_LONG).show();
                    return false;
                }
            }
        });
        webView.setDownloadListener((url, userAgent, contentDisposition, mimeType, contentLength) -> {
            openExternalIfNeeded(Uri.parse(url));
        });

        // Cookies survive app restarts. A cash register session is ended only
        // when the user explicitly signs out or the server expires the session.
        if (state != null) {
            webView.restoreState(state);
        } else {
            webView.loadUrl(HOME);
        }
    }

    private boolean acceptsImage(WebChromeClient.FileChooserParams params) {
        for (String type : params.getAcceptTypes()) {
            if (type != null && (type.startsWith("image/") ||
                    type.toLowerCase(Locale.ROOT).contains("image"))) return true;
        }
        return false;
    }

    private boolean openExternalIfNeeded(Uri uri) {
        final String scheme = uri.getScheme(), host = uri.getHost();
        if ("https".equalsIgnoreCase(scheme) &&
                ("donmacpos.com".equalsIgnoreCase(host) ||
                 "www.donmacpos.com".equalsIgnoreCase(host))) return false;
        if (!"https".equalsIgnoreCase(scheme) &&
            !"http".equalsIgnoreCase(scheme)) return true;
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri));
        } catch (Exception e) {
            Toast.makeText(this, "Unable to open external link.", Toast.LENGTH_SHORT).show();
        }
        return true;
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode != FILE_REQUEST || pendingFileUpload == null) return;
        Uri[] uploaded = null;
        if (resultCode == RESULT_OK) {
            if (data != null && data.getClipData() != null) {
                int count = data.getClipData().getItemCount();
                uploaded = new Uri[count];
                for (int i = 0; i < count; i++) uploaded[i] = data.getClipData().getItemAt(i).getUri();
            } else if (data != null && data.getData() != null) {
                uploaded = new Uri[]{data.getData()};
            } else if (cameraOutput != null) {
                uploaded = new Uri[]{cameraOutput};
            }
        }
        pendingFileUpload.onReceiveValue(uploaded);
        pendingFileUpload = null;
        cameraOutput = null;
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else moveTaskToBack(true);
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        if (webView != null) webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    protected void onPause() {
        if (webView != null) webView.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (webView != null) webView.onResume();
    }

    @Override
    protected void onDestroy() {
        if (pendingFileUpload != null) {
            pendingFileUpload.onReceiveValue(null);
            pendingFileUpload = null;
        }
        if (webView != null) {
            ((ViewGroup)webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }
}
