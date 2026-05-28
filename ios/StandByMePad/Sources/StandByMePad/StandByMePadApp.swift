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
    private let dashboardURL = URL(string: "http://192.168.1.43:8123/local/standbyme-app/index.html?v=glass-home-v2")!

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
        webView.load(URLRequest(url: dashboardURL, cachePolicy: .reloadIgnoringLocalCacheData))
    }
}
