export default function Slide06Challenges() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "6vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Section 04</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>CHALLENGES</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>06</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", gap: "2vh", marginTop: "1vh", marginBottom: "1vh" }}>
          <h2 style={{ fontSize: "2.8vw", fontWeight: 300, margin: 0, letterSpacing: "0.04em" }}>Compete with Friends</h2>
          <p style={{ fontSize: "1.1vw", opacity: 0.6, margin: 0, maxWidth: "60vw", lineHeight: 1.6 }}>
            Challenges are private or public prediction leagues. Create one for your group, set prizes, and track who has the best football instincts.
          </p>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2vh 3vw", marginTop: "1vh" }}>
            <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
              <div style={{ width: "0.3vw", background: "#E2B94E", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Create a Challenge</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Tap "New Challenge," set a name, visibility (public or private), and invite participants via code or link.</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
              <div style={{ width: "0.3vw", background: "#E2B94E", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Join a Challenge</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Enter an invite code under "Join by Code," or browse public challenges in the Discover tab and request to join.</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
              <div style={{ width: "0.3vw", background: "rgba(255,255,255,0.3)", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Public vs. Private</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Public challenges appear in Discover and anyone can request to join. Private challenges are invite-only.</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: "1.2vw", alignItems: "flex-start" }}>
              <div style={{ width: "0.3vw", background: "rgba(255,255,255,0.3)", marginTop: "0.3vh", alignSelf: "stretch", flexShrink: 0 }} />
              <div>
                <div style={{ fontSize: "1.2vw", fontWeight: 500, marginBottom: "0.4vh" }}>Participant Limits</div>
                <div style={{ fontSize: "0.95vw", opacity: 0.6, lineHeight: 1.5 }}>Your subscription plan determines how many total participants you can host across all your challenges.</div>
              </div>
            </div>
          </div>

          <div style={{ border: "1px solid rgba(226,185,78,0.3)", background: "rgba(226,185,78,0.06)", padding: "1.5vh 2vw", display: "flex", alignItems: "center", gap: "1.5vw" }}>
            <div style={{ width: "0.3vw", background: "#E2B94E", alignSelf: "stretch", flexShrink: 0 }} />
            <div style={{ fontSize: "1vw", opacity: 0.75, lineHeight: 1.5 }}>
              <strong style={{ color: "#E2B94E" }}>Free plan:</strong> Host up to 10 participants. Upgrade to a Premium plan to host larger groups and unlock advanced features.
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
