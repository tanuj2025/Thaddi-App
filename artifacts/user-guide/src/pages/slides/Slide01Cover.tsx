const base = import.meta.env.BASE_URL;

export default function Slide01Cover() {
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
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Revised</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>2026-06-09</div>
          </div>
        </div>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "1vw", marginBottom: "2vh" }}>
            <img src={`${base}ss-landing.jpg`} crossOrigin="anonymous" alt="" style={{ width: "5vw", height: "5vw", objectFit: "cover", borderRadius: "50%", border: "2px solid #E2B94E", opacity: 0.9 }} />
            <div style={{ fontSize: "0.8vw", textTransform: "uppercase", letterSpacing: "0.3em", opacity: 0.6, fontFamily: "monospace" }}>thaddi App</div>
          </div>
          <h1 style={{ fontSize: "6vw", fontWeight: 300, lineHeight: 0.9, margin: 0, letterSpacing: "0.04em" }}>USER</h1>
          <h1 style={{ fontSize: "6vw", fontWeight: 700, lineHeight: 0.9, margin: 0, letterSpacing: "0.04em", color: "#E2B94E" }}>GUIDE</h1>
          <div style={{ width: "8vw", height: "2px", background: "#E2B94E", marginTop: "2.5vh", opacity: 0.8 }} />
          <p style={{ fontSize: "1.3vw", opacity: 0.65, marginTop: "2vh", maxWidth: "42vw", lineHeight: 1.6, fontWeight: 300 }}>
            Predict match scores, compete in private challenges, and follow the World Cup 2026 live — all in one place.
          </p>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "0.5px solid rgba(255,255,255,0.2)", paddingTop: "1.5vh" }}>
          <div>
            <div style={{ fontSize: "0.6vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace" }}>Prepared By</div>
            <div style={{ fontSize: "0.9vw", fontFamily: "monospace" }}>thaddi App Team</div>
          </div>
          <div>
            <div style={{ fontSize: "0.6vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace" }}>Classification</div>
            <div style={{ fontSize: "0.9vw", fontFamily: "monospace" }}>PUBLIC</div>
          </div>
          <div>
            <div style={{ fontSize: "0.6vw", textTransform: "uppercase", letterSpacing: "0.15em", opacity: 0.4, fontFamily: "monospace" }}>Version</div>
            <div style={{ fontSize: "0.9vw", fontFamily: "monospace" }}>1.0</div>
          </div>
        </div>
      </div>
    </div>
  );
}
