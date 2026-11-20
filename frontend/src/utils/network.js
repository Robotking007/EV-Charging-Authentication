import deployment from "../deployedAddress.json";

export const FALLBACK_RPC_URL = deployment.rpcUrl || import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";

export async function switchOrAddChain(ethereum, targetChainId = 31337, rpcUrl = FALLBACK_RPC_URL) {
  if (!ethereum) return;
  const hexChainId = "0x" + Number(targetChainId).toString(16);
  if (Number(await ethereum.request({ method: "eth_chainId" })) === Number(targetChainId)) return;
  try {
    await ethereum.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: hexChainId }]
    });
  } catch (switchError) {
    if (
      switchError.code === 4902 ||
      switchError?.data?.originalError?.code === 4902 ||
      (typeof switchError.message === "string" && switchError.message.includes("4902"))
    ) {
      await ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{
          chainId: hexChainId,
          chainName: deployment.mode === "course" ? "EV Charging Besu IBFT" : "Hardhat Local EV Chain",
          rpcUrls: [rpcUrl],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }
        }]
      });
      if (Number(await ethereum.request({ method: "eth_chainId" })) !== Number(targetChainId)) {
        await ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: hexChainId }]
        });
      }
    } else {
      throw switchError;
    }
  }
}

