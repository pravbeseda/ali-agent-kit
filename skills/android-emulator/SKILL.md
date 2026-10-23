---
name: android-emulator
description: Boot and use Android emulators that several agents share, without leaving them running for days — every command that needs an emulator runs through `with-emulator <avd> -- <command>`, which boots the AVD headless if needed and holds a lease on it, and a launchd reaper shuts a headless emulator down once nobody has used it for 20 minutes. Use whenever a task needs an Android emulator — instrumented tests, adb, installing or checking an app — or the user runs /ali-android-emulator.
---

# Android emulators shared by agents

Several agents may use one emulator at the same time, so no agent knows whether an emulator is still needed. A lease says who is using one; the reaper kills a headless emulator only when no lease is left and it has been idle for 20 minutes.

`<skill>` below is the absolute path of the directory holding this file.

## Rules

- Boot and use emulators only through `with-emulator`. Never start one with `emulator -avd …` yourself.
- Never `adb emu kill` an emulator, and never kill its process: the reaper does that, and another agent may be in the middle of using it.
- A windowed emulator is a person's. Use it only when the user asks; the reaper never touches it.

## Run a command

```bash
node <skill>/scripts/with-emulator.mjs <avd> -- <command...>
```

It boots `<avd>` headless if it is not running and waits for the boot to finish, runs the command with `ANDROID_SERIAL` set to that emulator — `adb` and `./gradlew connectedAndroidTest` pick it up — and exits with the command's code. It never shuts the emulator down, so the next command reuses it without a reboot. Wrap every command, one at a time:

```bash
node <skill>/scripts/with-emulator.mjs Medium_Phone_API_36.0 -- ./gradlew connectedDebugAndroidTest
node <skill>/scripts/with-emulator.mjs Medium_Phone_API_36.0 -- adb install -r app/build/outputs/apk/debug/app-debug.apk
```

`emulator -list-avds` (in `$ANDROID_HOME/emulator`) names the AVDs. Exit code 2 means the arguments were wrong or this is not macOS; 1 means the emulator did not boot within 5 minutes or exited while booting — its log is `~/.ali-android-emulator/<avd>.log`, rewritten on every boot.

## The reaper

It has to be registered once per machine, by the user or with their go-ahead — it writes `~/Library/LaunchAgents/com.github.pravbeseda.ali-android-emulator.reaper.plist` and loads it:

```bash
node <skill>/scripts/install-reaper.mjs              # register, or re-register after the skill moved
node <skill>/scripts/install-reaper.mjs --uninstall  # remove
```

The plist runs the `reap.mjs` next to the script that registered it, every 5 minutes. Its log is `~/.ali-android-emulator/reaper.log`. Every run stamps `~/.ali-android-emulator/reaper-ran`; when the reaper has not run for 15 minutes — never registered, or launchd can no longer start it after a Node upgrade or a moved skill — `with-emulator` says so on stderr. Tell the user and offer to run the install. macOS only.
