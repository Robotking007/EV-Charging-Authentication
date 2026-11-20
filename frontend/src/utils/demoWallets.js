import { HDNodeWallet, Mnemonic } from "ethers";

// Hardhat's built-in local network funds accounts derived from this exact,
// publicly documented test mnemonic. Deriving from it here (rather than
// hardcoding private keys) reproduces Hardhat's default accounts exactly,
// with no risk of a transcription error breaking signatures.
// LOCAL TEST NETWORK ONLY — never use this mnemonic anywhere real funds exist.
const HARDHAT_TEST_MNEMONIC = "test test test test test test test test test test test junk";

export function getDemoWallet(index) {
  const mnemonic = Mnemonic.fromPhrase(HARDHAT_TEST_MNEMONIC);
  return HDNodeWallet.fromMnemonic(mnemonic, `m/44'/60'/0'/0/${index}`);
}

export function listDemoWallets(count = 6) {
  return Array.from({ length: count }, (_, i) => {
    const w = getDemoWallet(i);
    return { index: i, address: w.address };
  });
}
