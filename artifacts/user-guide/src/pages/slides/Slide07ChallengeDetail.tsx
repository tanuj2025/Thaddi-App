export default function Slide07ChallengeDetail() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "6vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Section 05</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>CHALLENGE DETAIL</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>07</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", gap: "4vw", alignItems: "flex-start", marginTop: "2vh", marginBottom: "1.5vh" }}>
          <div style={{ flex: 1 }}>
            <h2 style={{ fontSize: "2.6vw", fontWeight: 300, margin: "0 0 2.5vh 0", letterSpacing: "0.04em", lineHeight: 1.1 }}>Inside a Challenge</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.6vh" }}>
              <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
                <div style={{ width: "0.3vw", background: "#E2B94E", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Leaderboard</div>
                  <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Live ranking of all participants within the challenge, sorted by points accumulated from correct predictions.</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
                <div style={{ width: "0.3vw", background: "#E2B94E", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Predictions Tab</div>
                  <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>See what all participants predicted. Predictions are hidden until kickoff (unless the owner has set them to always visible).</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
                <div style={{ width: "0.3vw", background: "rgba(255,255,255,0.25)", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Challenge Chat</div>
                  <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>A live message thread visible to all participants. Use it to trash-talk, analyse, or celebrate.</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
                <div style={{ width: "0.3vw", background: "rgba(255,255,255,0.25)", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
                <div>
                  <div style={{ fontSize: "1.15vw", fontWeight: 500, marginBottom: "0.3vh" }}>Insight Cards</div>
                  <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Winning Probability and Ranking Impact cards help you understand how a correct prediction shifts your standing.</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex: 1 }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.15)", background: "rgba(255,255,255,0.03)", padding: "2vw" }}>
              <div style={{ fontSize: "0.7vw", fontFamily: "monospace", color: "#E2B94E", textTransform: "uppercase", letterSpacing: "0.15em", marginBottom: "1.5vh" }}>Owner Controls</div>
              <div style={{ display: "flex", flexDirection: "column", gap: "1.2vh" }}>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "0.5px solid rgba(255,255,255,0.1)", paddingBottom: "0.8vh" }}>
                  <span style={{ fontSize: "1vw", opacity: 0.75 }}>Edit name / description</span>
                  <span style={{ fontSize: "0.8vw", fontFamily: "monospace", color: "#E2B94E" }}>OWNER</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "0.5px solid rgba(255,255,255,0.1)", paddingBottom: "0.8vh" }}>
                  <span style={{ fontSize: "1vw", opacity: 0.75 }}>Toggle public/private</span>
                  <span style={{ fontSize: "0.8vw", fontFamily: "monospace", color: "#E2B94E" }}>OWNER</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "0.5px solid rgba(255,255,255,0.1)", paddingBottom: "0.8vh" }}>
                  <span style={{ fontSize: "1vw", opacity: 0.75 }}>Manage prizes</span>
                  <span style={{ fontSize: "0.8vw", fontFamily: "monospace", color: "#E2B94E" }}>OWNER</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "0.5px solid rgba(255,255,255,0.1)", paddingBottom: "0.8vh" }}>
                  <span style={{ fontSize: "1vw", opacity: 0.75 }}>Promote / demote assistants</span>
                  <span style={{ fontSize: "0.8vw", fontFamily: "monospace", color: "#E2B94E" }}>OWNER</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "0.5px solid rgba(255,255,255,0.1)", paddingBottom: "0.8vh" }}>
                  <span style={{ fontSize: "1vw", opacity: 0.75 }}>Generate invite codes</span>
                  <span style={{ fontSize: "0.8vw", fontFamily: "monospace", color: "#E2B94E" }}>OWNER</span>
                </div>
                <div style={{ display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: "1vw", opacity: 0.75 }}>Purchase decorative badges</span>
                  <span style={{ fontSize: "0.8vw", fontFamily: "monospace", color: "#BAE6FD" }}>PAID</span>
                </div>
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
