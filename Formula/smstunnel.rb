# Homebrew formula for the tap github.com/narcisbodea/homebrew-tap (install: brew install narcisbodea/tap/smstunnel).
# Before publishing the tap, set sha256 to the published npm tarball's checksum:
#   curl -sL https://registry.npmjs.org/smstunnel/-/smstunnel-1.0.0.tgz | shasum -a 256
class Smstunnel < Formula
  desc "Send texts from your computer through your own Android phone and number"
  homepage "https://smstunnel.io"
  url "https://registry.npmjs.org/smstunnel/-/smstunnel-1.0.0.tgz"
  sha256 "REPLACE_WITH_THE_SHA256_OF_THE_PUBLISHED_TARBALL"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *std_npm_args
    bin.install_symlink libexec.glob("bin/*")
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/smstunnel --version")
    # No key in the test sandbox: the CLI says how to sign in and ends with exit code 3.
    output = shell_output("#{bin}/smstunnel phones 2>&1", 3)
    assert_match "smstunnel login", output
  end
end
