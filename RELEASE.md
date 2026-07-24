# GitHub Release Standard

This document is the canonical packaging and publication reference for **Item Creator (DnD 5e)**.

## Official repository

`https://github.com/hammer-PvP/DnD-5e-Item-Creator`

## Required release assets

Every GitHub Release must publish these two files with these exact names:

- `module.json`
- `item-creator.zip`

Do not publish the installable package as `module.zip`. That filename is reserved for the separate Character Builder project and would make the two active module projects easy to confuse.

## Installable ZIP layout

The files of the Foundry module must be stored directly at the root of `item-creator.zip`:

```text
item-creator.zip
├── module.json
├── LICENSE
├── README.md
├── CHANGELOG.md
├── lang/
├── scripts/
├── styles/
└── templates/
```

Do not wrap those files in an additional `dnd5e-item-creator/` directory inside the installable ZIP.

## Manifest URLs

The release copy of `module.json` must keep these addresses:

```json
{
  "url": "https://github.com/hammer-PvP/DnD-5e-Item-Creator",
  "manifest": "https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/latest/download/module.json",
  "download": "https://github.com/hammer-PvP/DnD-5e-Item-Creator/releases/download/v0.0.1-alpha/item-creator.zip"
}
```

The `manifest` URL uses `releases/latest` so Foundry can discover the newest published manifest. The `download` URL must always be version-specific and must point to the exact tag of that build. Alpha and Beta publications should remain ordinary GitHub Releases when installation is expected through the `releases/latest` manifest URL.

## Version synchronization

Before publishing, confirm that the same version is used in:

- `module.json`;
- the release tag, prefixed with `v`;
- the GitHub Release title;
- `README.md`;
- `CHANGELOG.md`;
- any internal version constant shown by the interface.

Example:

```text
module.json version: 0.0.1-alpha
Git tag:             v0.0.1-alpha
Release title:       Item Creator v0.0.1 Alpha
```

## Release checklist

1. Validate JavaScript syntax and JSON files.
2. Confirm the Foundry and D&D5e compatibility declarations.
3. Confirm that `module.json` points to the versioned `item-creator.zip` URL for the exact release tag.
4. Build `item-creator.zip` with loose module files at its root.
5. Inspect the ZIP layout before publication.
6. Publish `module.json` and `item-creator.zip` as separate release assets.
7. Test installation with the manifest URL in Foundry.
8. Test update detection from the previously published version.

## Automated release workflow

`.github/workflows/release.yml` applies this standard whenever a tag matching `v*` is pushed. It validates the tag against `module.json`, builds `item-creator.zip`, checks the root layout, and publishes both required assets.
