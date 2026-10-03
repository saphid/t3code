import { useRoute } from "@react-navigation/native";
import { useRef, useState } from "react";
import { View } from "react-native";
import { WebView } from "react-native-webview";

import { AppText as Text } from "../../components/AppText";

/**
 * Dev-only proof harness: loads the web `/view-proof` page in the same
 * react-native-webview the app would host plugin views in, with `onMessage`
 * enabled so WebKit registers the `ReactNativeWebView` script message handler.
 * Results and every bridge message (with its sending frame URL) go to Metro logs.
 * Deep link: t3code-dev://view-proof?pair=<web pairing URL>&proof=<web proof URL>
 */
export function ViewProofRouteScreen() {
  const params = (useRoute().params ?? {}) as { pair?: string; proof?: string };
  // A second deep link reuses this screen; a new key starts its proof afresh.
  return <ViewProofWebView key={`${params.pair}|${params.proof}`} params={params} />;
}

function ViewProofWebView({ params }: { readonly params: { pair?: string; proof?: string } }) {
  const [uri, setUri] = useState(params.pair ?? params.proof ?? "about:blank");
  const webView = useRef<WebView<object>>(null);
  const [status, setStatus] = useState("loading");

  if (!__DEV__) return null;

  return (
    <View style={{ flex: 1 }}>
      <Text className="p-2 text-xs">view-proof: {status}</Text>
      <WebView<object>
        ref={webView}
        source={{ uri }}
        originWhitelist={["*"]}
        setSupportMultipleWindows={false}
        onShouldStartLoadWithRequest={(request) => {
          console.log(
            `[view-proof] navigation top=${request.isTopFrame} url=${request.url.replace(/#.*$/, "#…")}`,
          );
          return true;
        }}
        onLoadEnd={(event) => {
          const url = event.nativeEvent.url;
          if (params.proof && uri !== params.proof && !new URL(url).pathname.startsWith("/pair")) {
            setUri(params.proof);
            return;
          }
          if (url.includes("/view-proof")) {
            setStatus("running");
            const poll = `(function poll(){ if (window.__viewProof && window.__viewProof.done) { window.ReactNativeWebView.postMessage(JSON.stringify({ kind: "proof-result", rows: window.__viewProof.rows })); } else { setTimeout(poll, 500); } })(); true;`;
            webView.current?.injectJavaScript(poll);
          }
        }}
        onMessage={(event) => {
          const { url, data } = event.nativeEvent;
          if (data.startsWith('{"kind":"proof-result"')) {
            setStatus("done");
            console.log(`[view-proof] result ${data}`);
            return;
          }
          console.log(`[view-proof] bridge-message frameUrl=${url} data=${data.slice(0, 200)}`);
        }}
        style={{ flex: 1 }}
      />
    </View>
  );
}
