import React, { useState } from "react";
import LandingScreen from "./screens/LandingScreen.jsx";
import OnboardingScreen from "./screens/OnboardingScreen.jsx";
import BrowseScreen from "./screens/BrowseScreen.jsx";
import TutorChatScreen from "./screens/TutorChatScreen.jsx";

// Lightweight state router for the MVP. Swap for react-router when you add
// deep links / auth. Screens: landing -> onboarding -> browse -> chat.
export default function App() {
  const [screen, setScreen] = useState("landing");
  const [profile, setProfile] = useState(null); // { board, klass, lang }
  const [session, setSession] = useState(null); // { subject, chapter, topic }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-indigo-50/40 font-sans text-slate-900 antialiased">
      {screen === "landing" && <LandingScreen onStart={() => setScreen("onboarding")} />}

      {screen === "onboarding" && (
        <OnboardingScreen
          onHome={() => setScreen("landing")}
          onDone={(p) => { setProfile(p); setScreen("browse"); }}
        />
      )}

      {screen === "browse" && (
        <BrowseScreen
          profile={profile}
          onHome={() => setScreen("landing")}
          onOpenTopic={(s) => { setSession(s); setScreen("chat"); }}
        />
      )}

      {screen === "chat" && (
        <TutorChatScreen
          session={session}
          profile={profile}
          onHome={() => setScreen("landing")}
          onBack={() => setScreen("browse")}
        />
      )}
    </div>
  );
}
