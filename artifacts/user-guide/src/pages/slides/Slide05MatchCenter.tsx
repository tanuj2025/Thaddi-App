const base = import.meta.env.BASE_URL;

export default function Slide05MatchCenter() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "6vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Section 03</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>MATCH CENTER</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>05</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", gap: "5vw", alignItems: "center", marginTop: "1.5vh", marginBottom: "1.5vh" }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: "2.8vw", fontWeight: 300, margin: "0 0 2.5vh 0", letterSpacing: "0.04em", lineHeight: 1.1 }}>Predict Match Scores</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.8vh" }}>
              <div style={{ borderLeft: "2px solid #E2B94E", paddingLeft: "1.5vw" }}>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Browse by Status</div>
                <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>Filter matches by All, Live, Upcoming, or Finished using the tabs at the top of the Match Center page.</div>
              </div>
              <div style={{ borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: "1.5vw" }}>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Enter Your Prediction</div>
                <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>Tap any upcoming match card and type the Home and Away scores you expect. Submit before kickoff to lock it in.</div>
              </div>
              <div style={{ borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: "1.5vw" }}>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Track Your Progress</div>
                <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>A progress bar shows how many of the current round's matches you've predicted.</div>
              </div>
              <div style={{ borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: "1.5vw" }}>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Live Match Detail</div>
                <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>Tap any match for live scores, event timelines, and community prediction distribution trends.</div>
              </div>
            </div>
          </div>

          <div style={{ flex: 0.85 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.25)", padding: "0.8vw", background: "rgba(255,255,255,0.04)" }}>
              <img src={`${base}ss-schedule.jpg`} crossOrigin="anonymous" alt="Match schedule" style={{ width: "36vw", height: "23vh", objectFit: "cover", objectPosition: "top", display: "block" }} />
              <div style={{ fontSize: "0.7vw", fontFamily: "monospace", opacity: 0.4, marginTop: "0.8vh", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.1em" }}>Full Match Schedule — /schedule</div>
            </div>
            <div style={{ marginTop: "1.5vh", border: "1px solid rgba(226,185,78,0.3)", background: "rgba(226,185,78,0.06)", padding: "1.2vh 1.5vw", display: "flex", gap: "1vw", alignItems: "flex-start" }}>
              <div style={{ width: "0.3vw", background: "#E2B94E", alignSelf: "stretch", flexShrink: 0 }} />
              <div style={{ fontSize: "0.9vw", opacity: 0.75 }}>Predictions lock automatically at kickoff — submit yours early to stay in contention.</div>
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
