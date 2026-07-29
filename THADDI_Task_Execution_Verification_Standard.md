# THADDI TASK EXECUTION & VERIFICATION STANDARD

> Read this file BEFORE implementing any task.

## Global Rules

-   Read the assigned task completely.
-   Do not change unrelated code.
-   Preserve existing functionality.
-   Keep Web, iOS and Android behaviour consistent.
-   Attach screenshots and evidence.
-   Update Shared Task.
-   Update Dev Daily Log.
-   Do not mark a task complete until every verification item passes.

------------------------------------------------------------------------

# D1 Milestone

Goal: THADDI live on App Store + Google Play.

Execution Order

1.  D1.1 FIFA/IP Compliance
2.  D1.2 League Approval
3.  D1.3 League Activation
4.  D1.4 Monitoring
5.  D1.5 Payments
6.  D1.6 Store Builds
7.  D1.7 Full QA Gate
8.  D1.8 Store Submission
9.  D1.9 Production Monitoring

------------------------------------------------------------------------

# D1.1 FIFA/IP Compliance

Verify: - App names - Bundle metadata - Website - Screens - Arabic
strings - English strings - Push notifications - Emails - Store
listings - Keywords - Screenshots

Forbidden: - FIFA - World Cup - كأس العالم - Trophy images - FIFA
logos - Club crests - League logos

Allowed: - World Championship 2026 / بطولة العالم 2026 - Plain-text
league names

Evidence: - Compliance checklist - Screenshots

Exit: 100% clean before store submission.

------------------------------------------------------------------------

# D1.2 League Approval

Verify: - Founder approval recorded - Official competition dates -
Provider season dates separated - Readiness checklist updated

Do NOT activate leagues before approval.

------------------------------------------------------------------------

# D1.3 League Activation

For every approved league:

-   Create season
-   Map provider IDs
-   Import fixtures
-   Riyadh timezone
-   Prediction lock at kickoff
-   Score:
    -   Exact Score = 3
    -   Correct Winner/Draw = 1
    -   Else = 0
-   Verify leaderboard
-   Verify result sync

Validation: - Test minimum 3 fixtures end-to-end.

Not in season: - Coming Soon / قريباً

Evidence: - Screenshots - Test output

------------------------------------------------------------------------

# D1.4 Monitoring

Verify: - API uptime - Database - Sports feed - Prediction timing -
Background jobs - Notifications - Error tracking

Alerts: - Founder - Developer

------------------------------------------------------------------------

# D1.5 Payments

Verify

iOS - RevenueCat - Apple IAP - Purchase - Upgrade - Restore

Android - Google Billing - RevenueCat - Purchase - Upgrade - Restore

Web - Moyasar - Purchase - Upgrade - Challenge Badges

Cross-platform entitlement sync required.

Evidence: - Receipts - Screenshots

------------------------------------------------------------------------

# D1.6 Release Builds

Android - Release AAB - Signing key - Play Console - Billing - Content
Rating - Data Safety

iOS - App Store Connect - Build - Metadata - Privacy

Evidence: - Build screenshots

------------------------------------------------------------------------

# D1.7 Full QA Gate

Platforms: - Web - iOS - Android

Verify: - RTL - OTP - Challenge Flow - Prediction Flow - Lock Timing -
Results - Leaderboards - Notifications - Payments - League Data

PASS required on every platform.

No FAIL may proceed.

------------------------------------------------------------------------

# D1.8 Store Submission

Verify: - Metadata - Screenshots - Privacy - Signed Builds - QA Passed

Submit: - App Store - Google Play

------------------------------------------------------------------------

# D1.9 Production Monitoring

Monitor: - API - Database - Payments - Sports Feed - Notifications -
Crashes - Prediction Lock Timing

Daily Founder update required.

------------------------------------------------------------------------

# D5 Portfolio Cost Report

Track: - Hosting - Domains - Database - Email - OpenAI - Sports Feed -
Moyasar - RevenueCat - Apple Developer - Google Play - Other tools

Report: - Monthly Cost - Annual Cost - Top 3 Savings

------------------------------------------------------------------------

# Completion Checklist (Every Task)

Implementation - \[ \] Code Complete - \[ \] Regression Checked - \[ \]
Build Pass - \[ \] Tests Pass

Verification - \[ \] Web Verified - \[ \] iOS Verified - \[ \] Android
Verified - \[ \] Screenshots Attached - \[ \] Evidence Attached

Documentation - \[ \] Shared Task Updated - \[ \] Dev Daily Log
Updated - \[ \] Remaining Risks Listed - \[ \] Next Steps Added

A task is COMPLETE only after every applicable checkbox is complete.
