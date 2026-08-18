export const THUMBNAIL_REFERENCE_POLICY = `
Select references independently for every thumbnail. Never use a global default.

RIG SELECTION
- Match silhouette and proportions to the character role, pose, genre, and framing.
- Prefer Blocky or 2.0 for classic Roblox authenticity, Boy/Girl/Man/Woman for outfit fit,
  and Superhero only when the requested pose and role benefit from that silhouette.

FACE SELECTION
- Match the emotional story, headline, action, and intended click reaction.
- Prefer readable expressions with strong eyes and mouth shapes at 320px preview width.
- Do not choose only by filename; inspect the actual transparent decal.

APPROVAL
- Show the proposed rig and face before image generation.
- Let the user replace either reference.
- Send only the approved rig render and face decal to the image model.
- Preserve the selected face as a flat 2D decal with its exact linework and transparency.
`;
