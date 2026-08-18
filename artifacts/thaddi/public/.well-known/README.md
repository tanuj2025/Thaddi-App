# `.well-known` — Platform Verification Files

These two files enable **iOS Universal Links** and **Android App Links** so that
`https://thaddi.app/join/<code>` opens the installed Thaddi app directly instead
of the browser.

Both files are served by the API server at runtime (see `artifacts/api-server/src/app.ts`)
and copied into the web artifact's static build via Vite's `public/` passthrough.

---

## `apple-app-site-association`

### What it controls
Apple fetches this file (without cookies, from CDN edge nodes) during app
install/update to decide whether Universal Links for `thaddi.app` should open
the Thaddi iOS app. The `appIDs` values must match the **application identifier**
that is embedded in the native binary's entitlement (`{TEAM_ID}.{bundle_id}`).

### Critical field: Apple Team ID prefix

The file currently contains:

```json
"appIDs": ["1073120137.app.thaddi"]
```

and:

```json
"webcredentials": { "apps": ["1073120137.app.thaddi"] }
```

`1073120137` is the Team ID prefix. Apple Team IDs are **10-character
alphanumeric** strings (e.g. `A1B2C3D4E5`). If the file's Team ID does not
match the one that was used to sign the installed binary, iOS silently falls
back to opening Safari.

#### How to find the correct Team ID

**Option A — EAS credentials (fastest)**
```bash
cd artifacts/thaddi-mobile
eas credentials   # choose iOS → select the production profile
```
The "Team ID" field is shown in the output.

**Option B — App Store Connect**
1. Go to <https://appstoreconnect.apple.com>
2. Click your name (top-right) → **Membership**
3. Copy the **Team ID** (10-character alphanumeric string, e.g. `A1B2C3D4E5`)

**Option C — Xcode**
Xcode → Preferences/Settings → Accounts → select your Apple ID → view team details.

### How to update when correcting a wrong Team ID in the file

If the native binary already has the correct Team ID in its entitlement (i.e.
the app was always built for the right team — only the hosted file was wrong),
updating and deploying this file is sufficient. No new native build is needed:

Replace `1073120137` in **both** places:

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["A1B2C3D4E5.app.thaddi"],
        "components": [
          { "/": "/join/*", "comment": "Match all challenge invite deep links" }
        ]
      }
    ]
  },
  "webcredentials": {
    "apps": ["A1B2C3D4E5.app.thaddi"]
  }
}
```

iOS picks up the updated file the next time each user installs or updates the app.

### How to update when migrating to a new Apple Developer Team

If the app is being transferred to a different Apple Developer Team, a **new
native build signed under the new Team ID is required** (the application
identifier in the binary's entitlement changes). During the transition, keep
**both** app IDs in the AASA so existing installs (signed by the old team)
continue working until users update:

```json
"appIDs": ["NEW_TEAM_ID.app.thaddi", "1073120137.app.thaddi"]
```

Remove the old entry once the old binary version is no longer in circulation.

---

## `assetlinks.json`

### What it controls
Android fetches this file during app install to verify that `https://thaddi.app`
is associated with the `app.thaddi` package. If the `sha256_cert_fingerprints`
array does not contain the fingerprint of the certificate signing the installed
APK, Android silently falls back to the browser.

### Why the Play App Signing fingerprint is needed

When **Google Play App Signing** is enabled (as it is for this app), Google
re-signs every APK/AAB with a Google-managed key before delivering it to users.
Android verifies the *installed* certificate — which is the Play App Signing
key, not the upload key. The current file lists only the upload/local keystore
fingerprint, so Play-distributed installs will fail App Links verification.

| Certificate | When it applies |
|-------------|----------------|
| **Google Play App Signing key** | All Play-distributed installs (every track: production, closed, open, internal) |
| **Upload/local keystore** | Direct APK installs only (sideloading, not Play-distributed) |

Rotating the Play **upload** key has no effect on this file — the upload key
only authorises future submissions; the Play App Signing key (what users
receive) is unchanged.

### How to find the Google Play App Signing SHA-256 fingerprint

1. Open **Google Play Console** → select the Thaddi app
2. Go to **Release → Setup → App integrity**
3. Click the **"App signing key certificate"** tab
4. Copy the **SHA-256 certificate fingerprint** (colon-separated 64-char hex)

### How to update
Add the Play App Signing fingerprint to the `sha256_cert_fingerprints` array
alongside the existing upload-keystore entry (retain the upload entry only if
you distribute direct APKs outside the Play Store):

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "app.thaddi",
      "sha256_cert_fingerprints": [
        "GOOGLE_PLAY_APP_SIGNING_SHA256_FINGERPRINT",
        "F4:3A:B8:E9:3B:9E:B7:7C:F0:A8:F8:69:FB:C4:31:77:ED:40:1A:B6:13:6E:24:C4:02:A4:03:A3:3D:B6:1D:3E"
      ]
    }
  }
]
```

Deploying this updated file is sufficient. Android re-runs `autoVerify` on next
install/update; no new native build is required.

---

## When to update these files vs. when a new native build is required

> **Key principle**: the hosted files are fetched from the server at install/update
> time. A server-only update is sufficient whenever the app's existing native
> entitlement already reflects the intended configuration and only the *hosted
> file* was wrong. A new native build is required whenever the native
> entitlement itself must change (bundle ID, package name, signing identity, or
> associated domain).

| Scenario | File updates needed | New native build? | Notes |
|----------|---------------------|------------------|-------|
| **File had wrong Team ID; native binary already signed by correct team** | Update Team ID prefix in AASA | ❌ No | Deploy updated file; iOS picks it up on next install/update |
| **Actual Apple Developer Team migration** (new signing identity) | Add `NEW_TEAM.app.thaddi` to AASA; keep old entry during transition | ✅ Yes — entitlement changes | Remove old entry once old binary version is retired |
| **Add Play App Signing fingerprint** (fix for Play-distributed users) | Add fingerprint to `sha256_cert_fingerprints` | ❌ No | Deploy updated file; Android verifies on next install/update |
| **Play upload key rotation** | None | ❌ No | Upload key only authorises submissions; Play App Signing key is unchanged |
| **iOS bundle identifier change** | Update `appIDs` + `webcredentials.apps` in AASA to `{TEAM_ID}.new.bundle.id` | ✅ Yes — new bundle ID requires new native signing identity and provisioning | |
| **Android package name change** | Update `package_name` in `assetlinks.json` | ✅ Yes — new package requires new native build for its own identity reasons | |
| **Associated domain change** (`thaddi.app` → new host) | Serve both files at `https://new-host/.well-known/`; `assetlinks.json` has no host field — do **not** change `package_name` | ✅ Yes — domain entitlements are baked into the binary (`associatedDomains` on iOS, `intentFilters` host on Android in `app.json`) | |
| **Google Play App Signing key change** (rare) | Update `sha256_cert_fingerprints` with the new fingerprint | ✅ Yes — existing Play-distributed installs cannot update across a signing-identity change | |

---

## Required production steps when a new native build is needed

```bash
cd artifacts/thaddi-mobile

# Android
eas build --platform android --profile production
# Submit via EAS Submit or Google Play Console

# iOS
eas build --platform ios --profile production
# Submit to the App Store via EAS Submit or Transporter
```

Apple re-fetches `apple-app-site-association` when users install or update.
Android re-runs `autoVerify` on install/update. Existing installs cannot be
forced to re-check without a user-initiated update.

---

## Validating the files are reachable and correct

Both files must return HTTP 200 with `Content-Type: application/json`:

```bash
curl -I https://thaddi.app/.well-known/assetlinks.json
curl -I https://thaddi.app/.well-known/apple-app-site-association
```

Verify identifiers are present:

```bash
# iOS: confirm bundle ID appears in both arrays
curl -s https://thaddi.app/.well-known/apple-app-site-association | \
  node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
    console.log('appIDs:', j.applinks.details[0].appIDs); \
    console.log('webcredentials:', j.webcredentials.apps);"

# Android: confirm package name and number of fingerprints
curl -s https://thaddi.app/.well-known/assetlinks.json | \
  node -e "const j=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')); \
    console.log('package:', j[0].target.package_name); \
    console.log('fingerprints:', j[0].target.sha256_cert_fingerprints);"
```
