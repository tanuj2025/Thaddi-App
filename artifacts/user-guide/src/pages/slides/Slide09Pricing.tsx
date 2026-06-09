const base = import.meta.env.BASE_URL;

export default function Slide09Pricing() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "6vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Section 08</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>PRICING &amp; PLANS</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>09</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", gap: "5vw", alignItems: "center", marginTop: "1.5vh", marginBottom: "1.5vh" }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: "2.8vw", fontWeight: 300, margin: "0 0 2.5vh 0", letterSpacing: "0.04em", lineHeight: 1.1 }}>Subscription Plans</h2>
            <p style={{ fontSize: "1.05vw", opacity: 0.6, margin: "0 0 2.5vh 0", lineHeight: 1.6 }}>
              Predicting and joining challenges is free. Upgrade to host larger groups or unlock premium features.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "1.5vh" }}>
              <div style={{ border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)", padding: "1.5vh 2vw", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "1.2vw", fontWeight: 600 }}>Free</div>
                  <div style={{ fontSize: "0.9vw", opacity: 0.6, marginTop: "0.3vh" }}>Predict all matches, join up to 10-participant challenges</div>
                </div>
                <div style={{ fontSize: "1.3vw", fontFamily: "monospace", opacity: 0.5 }}>0 SAR</div>
              </div>
              <div style={{ border: "1px solid #E2B94E", background: "rgba(226,185,78,0.06)", padding: "1.5vh 2vw", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <div style={{ fontSize: "1.2vw", fontWeight: 600, color: "#E2B94E" }}>Premium</div>
                  <div style={{ fontSize: "0.9vw", opacity: 0.7, marginTop: "0.3vh" }}>Host larger challenges, priority support, exclusive badges</div>
                </div>
                <div style={{ fontSize: "0.8vw", fontFamily: "monospace", color: "#E2B94E" }}>SEE /PRICING</div>
              </div>
            </div>

            <div style={{ marginTop: "2.5vh", border: "1px solid rgba(226,185,78,0.3)", background: "rgba(226,185,78,0.06)", padding: "1.5vh 2vw", display: "flex", alignItems: "center", gap: "1.5vw" }}>
              <div style={{ width: "0.3vw", background: "#E2B94E", alignSelf: "stretch", flexShrink: 0 }} />
              <div style={{ fontSize: "1vw", opacity: 0.75, lineHeight: 1.5 }}>
                <strong style={{ color: "#E2B94E" }}>Badges:</strong> Challenge owners can also purchase decorative badge emblems for their challenge through the in-app badge shop (paid via Moyasar).
              </div>
            </div>
          </div>

          <div style={{ flex: 0.85 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.25)", padding: "0.8vw", background: "rgba(255,255,255,0.04)" }}>
              <img src={`${base}ss-pricing.jpg`} crossOrigin="anonymous" alt="Pricing page" style={{ width: "36vw", height: "26vh", objectFit: "cover", objectPosition: "top", display: "block" }} />
              <div style={{ fontSize: "0.7vw", fontFamily: "monospace", opacity: 0.4, marginTop: "0.8vh", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.1em" }}>thaddi App — /pricing</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "0.5px solid rgba(255,255,255,0.2)", paddingTop: "1.5vh" }}>
          <div style={{ fontSize: "0.8vw", fontFamily: "monospace", opacity: 0.4 }}>thaddi App — User Guide v1.0</div>
          <div style={{ fontSize: "0.8vw", fontFamily: "monospace", opacity: 0.4 }}>thaddi.app</div>
        </div>
      </div>
    </div>
  );
}
