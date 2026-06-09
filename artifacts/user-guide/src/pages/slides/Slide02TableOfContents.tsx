export default function Slide02TableOfContents() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "7vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Section</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>TABLE OF CONTENTS</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>02</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "0" }}>
          <h2 style={{ fontSize: "2.4vw", fontWeight: 300, margin: "0 0 3vh 0", letterSpacing: "0.06em" }}>CONTENTS</h2>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1.2vh 6vw" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>01</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Getting Started</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>02</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Home Dashboard</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>03</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Match Center</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>04</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Challenges</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>05</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Challenge Detail</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>06</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Rankings</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>07</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Profile & Account</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: "1.5vw", borderBottom: "0.5px solid rgba(255,255,255,0.12)", paddingBottom: "1.2vh" }}>
              <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E", minWidth: "2.5vw" }}>08</span>
              <span style={{ fontSize: "1.4vw", fontWeight: 300 }}>Pricing & Plans</span>
            </div>
          </div>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", borderTop: "0.5px solid rgba(255,255,255,0.2)", paddingTop: "1.5vh" }}>
          <div style={{ fontSize: "0.8vw", fontFamily: "monospace", opacity: 0.4 }}>thaddi App — User Guide v1.0</div>
          <div style={{ fontSize: "0.8vw", fontFamily: "monospace", opacity: 0.4 }}>2026-06-09</div>
        </div>
      </div>
    </div>
  );
}
