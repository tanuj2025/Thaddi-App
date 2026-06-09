export default function Slide10Closing() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />
      <div style={{ position: "absolute", top: "5vh", left: "5vw", right: "5vw", bottom: "5vh", border: "0.5px solid rgba(255,255,255,0.1)" }} />

      <div style={{ padding: "7vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Document No.</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>UG-THADDI-001</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Status</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace", color: "#E2B94E" }}>PUBLISHED</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "flex-start" }}>
          <div style={{ fontSize: "0.8vw", textTransform: "uppercase", letterSpacing: "0.3em", opacity: 0.5, fontFamily: "monospace", marginBottom: "2vh" }}>You're Ready</div>
          <h1 style={{ fontSize: "5.5vw", fontWeight: 300, lineHeight: 0.95, margin: 0, letterSpacing: "0.04em" }}>START</h1>
          <h1 style={{ fontSize: "5.5vw", fontWeight: 700, lineHeight: 0.95, margin: 0, letterSpacing: "0.04em", color: "#E2B94E" }}>PREDICTING</h1>
          <div style={{ width: "8vw", height: "2px", background: "#E2B94E", marginTop: "2.5vh", opacity: 0.8 }} />
          <p style={{ fontSize: "1.25vw", opacity: 0.6, marginTop: "2vh", maxWidth: "40vw", lineHeight: 1.7, fontWeight: 300 }}>
            Create or join a challenge, predict this week's World Cup matches, and climb the rankings. The best football minds rise to the top.
          </p>

          <div style={{ display: "flex", gap: "2vw", marginTop: "4vh" }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.3)", padding: "1.5vh 2.5vw" }}>
              <div style={{ fontSize: "0.65vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace", marginBottom: "0.5vh" }}>Website</div>
              <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>thaddi.app</div>
            </div>
            <div style={{ border: "1px solid rgba(255,255,255,0.3)", padding: "1.5vh 2.5vw" }}>
              <div style={{ fontSize: "0.65vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace", marginBottom: "0.5vh" }}>Support</div>
              <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>support@thaddi.app</div>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "0.5px solid rgba(255,255,255,0.2)", paddingTop: "1.5vh" }}>
          <div>
            <div style={{ fontSize: "0.6vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace" }}>Guide Version</div>
            <div style={{ fontSize: "0.9vw", fontFamily: "monospace" }}>1.0 — June 2026</div>
          </div>
          <div>
            <div style={{ fontSize: "0.6vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace" }}>Pages</div>
            <div style={{ fontSize: "0.9vw", fontFamily: "monospace" }}>10</div>
          </div>
          <div>
            <div style={{ fontSize: "0.6vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace" }}>End of Document</div>
            <div style={{ fontSize: "0.9vw", fontFamily: "monospace" }}>EOF</div>
          </div>
        </div>
      </div>
    </div>
  );
}
