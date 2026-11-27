package com.donmacpos.attendance;
import android.app.Activity;
import android.os.Bundle;
import android.webkit.*;
import android.net.Uri;
import android.content.Intent;
import android.graphics.Color;
import android.view.View;
import android.widget.LinearLayout;
import android.widget.TextView;
public class MainActivity extends Activity {
 private WebView web;
 private ValueCallback<Uri[]> filePicker;
 private static final int FILE_PICKER=31;
 private static final String HOME="https://donmacpos.com/";
 private boolean allowed(Uri u){String path=u.getPath();if(path==null)path="/";return "https".equalsIgnoreCase(u.getScheme())&&"donmacpos.com".equalsIgnoreCase(u.getHost())&&(u.getPort()==-1||u.getPort()==443)&&!path.startsWith("/admin-control")&&!path.startsWith("/supply-chain")&&!path.startsWith("/platform-admin")&&!path.startsWith("/supply-office");}
 @Override public void onCreate(Bundle state){
  super.onCreate(state);
  LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.WHITE);
  layout.setOnApplyWindowInsetsListener((v,insets)->{v.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets.consumeSystemWindowInsets();});
  web=new WebView(this);layout.addView(web,new LinearLayout.LayoutParams(-1,-1));setContentView(layout);
  WebSettings settings=web.getSettings();settings.setUserAgentString(settings.getUserAgentString()+" DonMacCashierApp/1");settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
  WebView.setWebContentsDebuggingEnabled(false);
  web.setWebViewClient(new WebViewClient(){
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest req){return !allowed(req.getUrl());}
   @Override public boolean shouldOverrideUrlLoading(WebView view,String url){return !allowed(Uri.parse(url));}
  });
  web.setWebChromeClient(new WebChromeClient(){
   @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
    if(filePicker!=null)filePicker.onReceiveValue(null);
    filePicker=callback;
    try{startActivityForResult(params.createIntent(),FILE_PICKER);return true;}
    catch(android.content.ActivityNotFoundException ex){filePicker.onReceiveValue(null);filePicker=null;return true;}
   }
  });
  web.setDownloadListener((url,agent,disposition,mime,length)->{
   Uri u=Uri.parse(url);
   if(!allowed(u)){android.widget.Toast.makeText(this,"This download is not supported in the Android app.",android.widget.Toast.LENGTH_SHORT).show();return;}
   try{
    android.app.DownloadManager.Request request=new android.app.DownloadManager.Request(u);
    request.addRequestHeader("User-Agent",agent);
    String cookies=CookieManager.getInstance().getCookie(url);
    if(cookies!=null)request.addRequestHeader("Cookie",cookies);
    request.setMimeType(mime);
    request.setTitle(URLUtil.guessFileName(url,disposition,mime));
    request.setNotificationVisibility(android.app.DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
    ((android.app.DownloadManager)getSystemService(DOWNLOAD_SERVICE)).enqueue(request);
   }catch(Exception ex){android.widget.Toast.makeText(this,"Download could not start.",android.widget.Toast.LENGTH_SHORT).show();}
  });
  web.loadUrl(HOME);
 }
 @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
  super.onActivityResult(requestCode,resultCode,data);
  if(requestCode==FILE_PICKER&&filePicker!=null){filePicker.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode,data));filePicker=null;}
 }
 @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
}
