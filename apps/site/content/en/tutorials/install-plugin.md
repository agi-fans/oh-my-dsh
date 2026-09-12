---
description: Install the shipped examples/hello bundle into the omdsh Profile with omdsh plugin add, verify the layer with --dump-config, and remove it again.
---

# Install the example plugin

This walkthrough installs the shipped `examples/hello` bundle into the omdsh Profile, verifies that the layer is active, and removes it again. You need an omdsh checkout and `pnpm` on `PATH`.

### See what the bundle declares

`examples/hello` is a complete `dsh.bundle` package: its `package.json` declares the patch file, and that file inserts one Cordis plugin row.

```text
examples/hello/package.json          # dsh.bundle.patch -> ./cordis.patch.yml
examples/hello/cordis.patch.yml      # one insert row for @agi-fans/omdsh-plugin-hello
```

A package can be installed as a plain library dependency, but only a `dsh.bundle.patch` declaration makes it join the Profile layer list.

### Install the bundle

From the repository root:

```sh
omdsh plugin add ./examples/hello
```

`omdsh plugin` initializes `$OMDSH_HOME/profiles/omdsh` on first use, runs `pnpm` inside it, installs the package, and reconciles `dsh.profile.bundles` against the installed packages that declare a bundle patch. The path is relative to the invoking directory; if it is missing there, omdsh walks parent directories for the same relative path, so the command also works from `apps/omdsh` as `pnpm --dir apps/omdsh omdsh plugin add ./examples/hello`.

### Verify the layer

```sh
omdsh --dump-config
```

The dump prints the composed entry list with a comment naming the layer that contributed each entry: the product bundle first, then `@agi-fans/omdsh-plugin-hello` from the Profile. Restart omdsh, then run `/hello`; the command also appears in `/help` and in slash autocomplete.

### Remove the bundle

```sh
omdsh plugin remove @agi-fans/omdsh-plugin-hello
```

The next dump no longer lists the package, and `/hello` disappears after the following restart.

### Troubleshoot

- `omdsh plugin` runs `pnpm` inside the Profile, so `pnpm` must be on `PATH`.
- A listed bundle that loses its `dsh.bundle.patch` declaration, or a package name that cannot resolve, fails at boot instead of degrading silently.
- If `/hello` does not appear, check that `--dump-config` lists the package and that omdsh was restarted after the install.

### Next

Author your own bundle with [Write a plugin](write-a-plugin.md). The compatibility contract is in [User plugins](../plugins.md), and the internal contribution surface is described in [Plugin internals](../plugin-internals.md).
