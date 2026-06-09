export default function Slide04HomeDashboard() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "6vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Section 02</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>HOME DASHBOARD</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>04</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "2.5vh", marginTop: "1vh", marginBottom: "1vh" }}>
          <h2 style={{ fontSize: "2.8vw", fontWeight: 300, margin: 0, letterSpacing: "0.04em" }}>Your Command Center</h2>
          <p style={{ fontSize: "1.1vw", opacity: 0.6, margin: 0, maxWidth: "55vw", lineHeight: 1.6 }}>
            After signing in, the Home Dashboard gives you a live snapshot of your standing and quick access to all key features.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "2vw", marginTop: "1vh" }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)", padding: "2vw" }}>
              <div style={{ fontSize: "0.7vw", fontFamily: "monospace", color: "#E2B94E", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "1.2vh" }}>Player Status</div>
              <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.8vh" }}>Level &amp; Points</div>
              <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>See your current tier (Bronze to Legend), total points earned, and how close you are to the next level.</div>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)", padding: "2vw" }}>
              <div style={{ fontSize: "0.7vw", fontFamily: "monospace", color: "#E2B94E", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "1.2vh" }}>Next Action</div>
              <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.8vh" }}>Smart Nudges</div>
              <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Banners alert you to pending predictions or challenges you haven't yet joined, so you never miss a game.</div>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,0.2)", background: "rgba(255,255,255,0.03)", padding: "2vw" }}>
              <div style={{ fontSize: "0.7vw", fontFamily: "monospace", color: "#E2B94E", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "1.2vh" }}>Quick Access</div>
              <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.8vh" }}>Jump To Any Section</div>
              <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Shortcut cards for Challenges, Global Rankings, and Upcoming Matches sit one tap away on the dashboard.</div>
            </div>
          </div>

          <div style={{ border: "1px solid rgba(226,185,78,0.3)", background: "rgba(226,185,78,0.06)", padding: "1.5vh 2vw", display: "flex", alignItems: "center", gap: "1.5vw" }}>
            <div style={{ width: "0.3vw", background: "#E2B94E", alignSelf: "stretch", flexShrink: 0 }} />
            <div style={{ fontSize: "1vw", opacity: 0.75, lineHeight: 1.5 }}>
              <strong style={{ color: "#E2B94E" }}>Tip:</strong> Use the "Share to WhatsApp" button on the dashboard to invite friends to your challenges directly from the app.
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
