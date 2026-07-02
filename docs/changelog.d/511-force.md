### Changed

- Rings now carry a tier-derived **force** stat that scales two things: how
  much raw damage an attack pushes, and how much a heart ring's own force
  can absorb of it. Heart loss from a landed or caught attack is now an
  uncapped integer count instead of a flat 1 heart — a high-force attacker
  can cost you more than 1 heart in a single exchange if your heart ring's
  force can't keep up, while a strong heart ring mitigates proportionally
  more.
- Earth's Neutral defense — and Neutral catches generally — are no longer
  unconditionally heart-safe. A Neutral block or parry now subtracts the
  defending ring's force from the attacker's force and only the leftover
  passes through to your hearts, so a significantly outmatched Earth (or any
  Neutral) defense can still bleed when the attacker is high enough force.
  The only outcome that stays flat-safe every time is a Strong parry, which
  triggers a rally instead.
- A weak block or parry (catching with the wrong element) now fills the
  defending ring's own gauge, reversed from the previous behavior where a
  weak catch moved no gauge at all.
