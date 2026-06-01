import React, { useState } from 'react';

export default function OnboardingScreen({ depStatus, onRecheck }) {
  const [checking, setChecking] = useState(false);

  const handleRecheck = async () => {
    setChecking(true);
    await onRecheck();
    setChecking(false);
  };

  const platform = navigator.platform.toLowerCase();
  const isMac = platform.includes('mac');
  const isWin = platform.includes('win');

  const capabilityFail = depStatus?.found && !depStatus?.has10BitX265;

  return (
    <div style={{
      background: '#1a1a1a',
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '40px 24px'
    }}>
      {/* Logo / Header */}
      <div style={{ textAlign: 'center', marginBottom: 32 }}>
        <div style={{ fontSize: 40, marginBottom: 8 }}>🎬</div>
        <div style={{ color: '#ED8B1E', fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', marginBottom: 4 }}>
          Fulldome Festival Delivery
        </div>
        <div style={{ color: '#e8e8e8', fontSize: 22, fontWeight: 700 }}>
          Dome Festival Delivery Tool
        </div>
      </div>

      {/* Main card */}
      <div style={{
        background: '#242424',
        border: '1px solid #404040',
        borderRadius: 12,
        maxWidth: 620,
        width: '100%',
        padding: '32px 36px'
      }}>
        <h2 style={{ color: '#e8e8e8', fontSize: 20, fontWeight: 700, marginBottom: 12 }}>
          One-time setup required
        </h2>

        {capabilityFail ? (
          <div style={{
            background: 'rgba(224,82,82,0.1)',
            border: '1px solid rgba(224,82,82,0.3)',
            borderRadius: 6,
            color: '#f08080',
            fontSize: 13,
            lineHeight: 1.6,
            padding: '12px 16px',
            marginBottom: 20
          }}>
            <strong>FFmpeg was found</strong> (version {depStatus.version}), but this version does not support 10-bit H.265 encoding,
            which is required for dome delivery. Please install a full FFmpeg build that includes libx265.
            See instructions below.
          </div>
        ) : (
          <p style={{ color: '#999', fontSize: 14, lineHeight: 1.7, marginBottom: 20 }}>
            The Dome Festival Delivery Tool uses FFmpeg to encode your film.
            FFmpeg was not detected on this system. Please follow the instructions below for your operating system.
          </p>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* macOS */}
          <PlatformSection
            title="macOS"
            icon="🍎"
            active={isMac}
          >
            <p style={{ color: '#999', marginBottom: 10, fontSize: 13 }}>Install FFmpeg via Homebrew. Open <strong style={{ color: '#e8e8e8' }}>Terminal</strong> and run:</p>
            <CodeBlock>/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"</CodeBlock>
            <p style={{ color: '#999', margin: '8px 0', fontSize: 13 }}>Then:</p>
            <CodeBlock>brew install ffmpeg</CodeBlock>
            <p style={{ color: '#999', marginTop: 8, fontSize: 13 }}>Then relaunch this app.</p>
          </PlatformSection>

          {/* Windows */}
          <PlatformSection
            title="Windows"
            icon="🪟"
            active={isWin}
          >
            <p style={{ color: '#999', marginBottom: 10, fontSize: 13 }}>
              Download FFmpeg from{' '}
              <a href="https://www.gyan.dev/ffmpeg/builds/" style={{ color: '#ED8B1E' }}>
                gyan.dev/ffmpeg/builds
              </a>
              {' '}— choose the <strong style={{ color: '#e8e8e8' }}>full</strong> build.
              Extract the ZIP, then add the <code style={{ background: '#333', padding: '1px 5px', borderRadius: 3 }}>bin/</code> folder to your system PATH.
              Then relaunch this app.
            </p>
          </PlatformSection>

          {/* Linux */}
          <PlatformSection
            title="Linux"
            icon="🐧"
            active={!isMac && !isWin}
          >
            <p style={{ color: '#999', marginBottom: 10, fontSize: 13 }}>Ubuntu/Debian:</p>
            <CodeBlock>sudo apt install ffmpeg</CodeBlock>
            <p style={{ color: '#999', margin: '8px 0', fontSize: 13 }}>Fedora:</p>
            <CodeBlock>sudo dnf install ffmpeg</CodeBlock>
            <p style={{ color: '#999', marginTop: 8, fontSize: 13 }}>Then relaunch this app.</p>
          </PlatformSection>
        </div>

        <div style={{ marginTop: 28, display: 'flex', justifyContent: 'center' }}>
          <button
            onClick={handleRecheck}
            disabled={checking}
            style={{
              background: '#ED8B1E',
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              cursor: checking ? 'not-allowed' : 'pointer',
              fontSize: 14,
              fontWeight: 700,
              opacity: checking ? 0.7 : 1,
              padding: '12px 28px'
            }}
          >
            {checking ? 'Checking…' : "I've installed FFmpeg — check again"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PlatformSection({ title, icon, active, children }) {
  return (
    <div style={{
      background: active ? 'rgba(237,139,30,0.06)' : '#1e1e1e',
      border: `1px solid ${active ? 'rgba(237,139,30,0.3)' : '#383838'}`,
      borderRadius: 8,
      padding: '16px 20px'
    }}>
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        marginBottom: 12
      }}>
        <span>{icon}</span>
        <span style={{ color: active ? '#ED8B1E' : '#e8e8e8', fontWeight: 700, fontSize: 15 }}>{title}</span>
        {active && (
          <span style={{
            background: 'rgba(237,139,30,0.15)',
            color: '#ED8B1E',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.1em',
            padding: '2px 7px',
            borderRadius: 4,
            textTransform: 'uppercase'
          }}>Your Platform</span>
        )}
      </div>
      {children}
    </div>
  );
}

function CodeBlock({ children }) {
  return (
    <div style={{
      background: '#111',
      border: '1px solid #333',
      borderRadius: 6,
      color: '#F2C200',
      fontFamily: "'SF Mono', 'Consolas', monospace",
      fontSize: 12,
      padding: '10px 14px',
      overflowX: 'auto',
      whiteSpace: 'pre-wrap',
      wordBreak: 'break-all'
    }}>
      {children}
    </div>
  );
}
