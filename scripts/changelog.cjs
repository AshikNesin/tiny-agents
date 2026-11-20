const githubChangelog = require("@changesets/changelog-github").default;

function plainReleaseLine(changeset) {
  const firstLine = (changeset.summary || "").split("\n")[0].trim();
  const sha = changeset.commit ? `\`${changeset.commit.slice(0, 7)}\` ` : "";
  return `- ${sha}${firstLine}`;
}

async function getReleaseLine(changeset, type, options) {
  try {
    return await githubChangelog.getReleaseLine(changeset, type, options);
  } catch (err) {
    const reason = err?.message?.split("\n")[0] || "unknown error";
    console.warn(
      `[changelog] GitHub enrichment failed (${reason}). ` +
        `Falling back to plain formatting for this entry.`,
    );
    return plainReleaseLine(changeset);
  }
}

async function getDependencyReleaseLine(changesets, type, options) {
  try {
    return await githubChangelog.getDependencyReleaseLine(changesets, type, options);
  } catch {
    return "";
  }
}

module.exports = { getReleaseLine, getDependencyReleaseLine };
