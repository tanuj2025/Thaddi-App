const base = import.meta.env.BASE_URL;

export default function Slide03GettingStarted() {
  return (
    <div style={{ width: "100vw", height: "100vh", overflow: "hidden", background: "#1B3A5C", fontFamily: "'DM Sans', sans-serif", position: "relative", color: "#FFFFFF" }}>
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)", backgroundSize: "2vw 2vh" }} />
      <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(255,255,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.08) 1px, transparent 1px)", backgroundSize: "10vw 10vh" }} />
      <div style={{ position: "absolute", top: "3vh", left: "3vw", right: "3vw", bottom: "3vh", border: "1px solid rgba(255,255,255,0.2)" }} />

      <div style={{ padding: "6vh 7vw", display: "flex", flexDirection: "column", height: "100%", justifyContent: "space-between", position: "relative", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Section 01</div>
            <div style={{ fontSize: "1vw", fontWeight: 600, fontFamily: "monospace" }}>GETTING STARTED</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.7vw", textTransform: "uppercase", letterSpacing: "0.2em", opacity: 0.5, fontFamily: "monospace" }}>Page</div>
            <div style={{ fontSize: "1vw", fontFamily: "monospace" }}>03</div>
          </div>
        </div>

        <div style={{ flex: 1, display: "flex", gap: "5vw", alignItems: "center", marginTop: "2vh", marginBottom: "2vh" }}>
          <div style={{ flex: 1.1 }}>
            <h2 style={{ fontSize: "3vw", fontWeight: 300, margin: "0 0 3vh 0", letterSpacing: "0.04em", lineHeight: 1.1 }}>
              Create Your Account
            </h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "1.8vh" }}>
              <div style={{ display: "flex", gap: "1.5vw", alignItems: "flex-start" }}>
                <div style={{ width: "2.2vw", height: "2.2vw", border: "1px solid #E2B94E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "0.2vh" }}>
                  <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E" }}>01</span>
                </div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 500, marginBottom: "0.3vh" }}>Visit thaddi.app</div>
                  <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>Open the app in your browser and click Sign Up in the top navigation.</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1.5vw", alignItems: "flex-start" }}>
                <div style={{ width: "2.2vw", height: "2.2vw", border: "1px solid #E2B94E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "0.2vh" }}>
                  <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E" }}>02</span>
                </div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 500, marginBottom: "0.3vh" }}>Sign up with Google or Email</div>
                  <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>Use your Google account for one-click sign-in, or enter your email and create a password.</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1.5vw", alignItems: "flex-start" }}>
                <div style={{ width: "2.2vw", height: "2.2vw", border: "1px solid #E2B94E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "0.2vh" }}>
                  <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E" }}>03</span>
                </div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 500, marginBottom: "0.3vh" }}>Complete Onboarding</div>
                  <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>Choose a display name, upload an avatar, and optionally verify your mobile number.</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: "1.5vw", alignItems: "flex-start" }}>
                <div style={{ width: "2.2vw", height: "2.2vw", border: "1px solid #E2B94E", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: "0.2vh" }}>
                  <span style={{ fontSize: "0.9vw", fontFamily: "monospace", color: "#E2B94E" }}>04</span>
                </div>
                <div>
                  <div style={{ fontSize: "1.3vw", fontWeight: 500, marginBottom: "0.3vh" }}>Accept Terms &amp; Start Predicting</div>
                  <div style={{ fontSize: "1vw", opacity: 0.6, lineHeight: 1.5 }}>Review and accept the Terms of Service — you're ready to play.</div>
                </div>
              </div>
            </div>
          </div>

          <div style={{ flex: 0.9, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <div style={{ border: "1px solid rgba(255,255,255,0.25)", padding: "0.8vw", background: "rgba(255,255,255,0.04)" }}>
              <img src={`${base}ss-landing.jpg`} crossOrigin="anonymous" alt="thaddi App landing page" style={{ width: "38vw", height: "22vh", objectFit: "cover", objectPosition: "top", display: "block" }} />
              <div style={{ fontSize: "0.7vw", fontFamily: "monospace", opacity: 0.4, marginTop: "0.8vh", textAlign: "center", textTransform: "uppercase", letterSpacing: "0.1em" }}>thaddi App — Landing Page</div>
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
