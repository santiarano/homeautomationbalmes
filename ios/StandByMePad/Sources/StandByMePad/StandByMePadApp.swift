import SwiftUI
import WebKit

@main
struct StandByMePadApp: App {
    var body: some Scene {
        WindowGroup {
            DashboardWebView()
                .ignoresSafeArea()
                .statusBarHidden(true)
        }
    }
}

struct DashboardWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.allowsInlineMediaPlayback = true
        configuration.mediaTypesRequiringUserActionForPlayback = []

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.backgroundColor = .black
        webView.scrollView.backgroundColor = .black
        webView.scrollView.bounces = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.allowsBackForwardNavigationGestures = false

        loadDashboard(in: webView)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    private func loadDashboard(in webView: WKWebView) {
        guard
            let indexURL = Bundle.main.url(
                forResource: "index",
                withExtension: "html",
                subdirectory: "webos-app"
            )
        else {
            webView.loadHTMLString("<h1 style='color:white;background:black'>StandByMe files missing</h1>", baseURL: nil)
            return
        }

        let webAppURL = indexURL.deletingLastPathComponent()
        webView.loadFileURL(indexURL, allowingReadAccessTo: webAppURL)
    }
}
