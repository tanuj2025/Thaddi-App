export default function Slide08Rankings() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "6vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Sections 06 &amp; 07</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>RANKINGS &amp; PROFILE</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>08</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", gap: "5vw", alignItems: "flex-start", marginTop: "2vh", marginBottom: "1.5vh" }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: "2.4vw", fontWeight: 300, margin: "0 0 1.5vh 0", letterSpacing: "0.04em" }}>Global Rankings</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.4vh" }}>
              <div style={{ borderLeft: "2px solid #E2B94E", paddingLeft: "1.2vw" }}>
                <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Your Rank Card</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>A pinned card at the top of the Rankings page shows your current global position and total points at a glance.</div>
              </div>
              <div style={{ borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: "1.2vw" }}>
                <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Leaderboard</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Paginated list of top players with rank movement arrows (up, down, new). See who's climbing after each round.</div>
              </div>
              <div style={{ borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: "1.2vw" }}>
                <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Share Your Rank</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Share your current standing directly to WhatsApp with one tap from the Rankings page.</div>
              </div>
            </div>

            <div style={{ marginTop: "3vh", width: "80%", height: "0.5px", background: "rgba(255,255,255,0.15)" }} />
            <div style={{ marginTop: "2vh", fontSize: "0.75vw", fontFamily: "monospace", color: "#E2B94E", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "0.8vh" }}>Scoring System</div>
            <div style={{ display: "flex", gap: "2vw" }}>
              <div style={{ border: "1px solid rgba(255,255,255,0.15)", padding: "1.2vh 1.5vw", textAlign: "center" }}>
                <div style={{ fontSize: "2vw", fontWeight: 700, color: "#E2B94E", fontFamily: "monospace" }}>3</div>
                <div style={{ fontSize: "0.8vw", opacity: 0.6, marginTop: "0.3vh" }}>Exact Score</div>
              </div>
              <div style={{ border: "1px solid rgba(255,255,255,0.15)", padding: "1.2vh 1.5vw", textAlign: "center" }}>
                <div style={{ fontSize: "2vw", fontWeight: 700, color: "#BAE6FD", fontFamily: "monospace" }}>1</div>
                <div style={{ fontSize: "0.8vw", opacity: 0.6, marginTop: "0.3vh" }}>Correct Outcome</div>
              </div>
              <div style={{ border: "1px solid rgba(255,255,255,0.15)", padding: "1.2vh 1.5vw", textAlign: "center" }}>
                <div style={{ fontSize: "2vw", fontWeight: 700, opacity: 0.3, fontFamily: "monospace" }}>0</div>
                <div style={{ fontSize: "0.8vw", opacity: 0.6, marginTop: "0.3vh" }}>Wrong</div>
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: "2.4vw", fontWeight: 300, margin: "0 0 1.5vh 0", letterSpacing: "0.04em" }}>Your Profile</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.4vh" }}>
              <div style={{ borderLeft: "2px solid #E2B94E", paddingLeft: "1.2vw" }}>
                <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Badges &amp; Achievements</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Earn badges for milestones like first exact score, top 10 global, and more. View all with award dates on your profile.</div>
              </div>
              <div style={{ borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: "1.2vw" }}>
                <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Lifetime Stats</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Competitions won, prediction accuracy %, and exact scoreline count — your permanent record of performance.</div>
              </div>
              <div style={{ borderLeft: "2px solid rgba(255,255,255,0.2)", paddingLeft: "1.2vw" }}>
                <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Account Settings</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Change email, password, or mobile number. Toggle language between Arabic and English. Sign out.</div>
              </div>
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
