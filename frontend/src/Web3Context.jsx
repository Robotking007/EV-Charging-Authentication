import React, { createContext, useContext, useEffect, useMemo, useState, useCallback, useRef } from "react";
import { BrowserProvider, JsonRpcProvider, Contract } from "ethers";
import { Web3Auth } from "@web3auth/modal";
import { CHAIN_NAMESPACES, WEB3AUTH_NETWORK } from "@web3auth/base";
import { EthereumPrivateKeyProvider } from "@web3auth/ethereum-provider";
import registryArtifact from "./abi/EVTrustRegistry.json";
import deployment from "./deployedAddress.json";
import { getDemoWallet } from "./utils/demoWallets.js";
import { FALLBACK_RPC_URL, switchOrAddChain } from "./utils/network.js";

const Web3Ctx = createContext(null);

const ADDRESS_STORAGE_KEY = deployment.deployedAt
  ? `ev-trust-registry-address:${deployment.deployedAt}`
  : "ev-trust-registry-address";
const AUTH_MODE_STORAGE_KEY = "ev-trust-auth-mode";
const DEV_WALLET_INDEX_STORAGE_KEY = "ev-trust-dev-wallet-index";

export const TRUST_ENGINE_URL = import.meta.env.VITE_TRUST_ENGINE_URL || "/api/trust-engine";
export { FALLBACK_RPC_URL };
const TARGET_CHAIN_ID = Number(deployment.chainId || 31337);

const WEB3AUTH_CLIENT_ID = import.meta.env.VITE_WEB3AUTH_CLIENT_ID;
const WEB3AUTH_NETWORK_NAME = import.meta.env.VITE_WEB3AUTH_NETWORK || "sapphire_devnet";

const web3authChainConfig = {
  chainNamespace: CHAIN_NAMESPACES.EIP155,
  chainId: "0x" + TARGET_CHAIN_ID.toString(16),
  rpcTarget: FALLBACK_RPC_URL,
  displayName: "Local EV Trust Chain",
  ticker: "ETH",
  tickerName: "Ethereum"
};

export function Web3Provider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [authMode, setAuthMode] = useState(null); // "injected" | "dev" | "web3auth" | null
  const [injectedWallet, setInjectedWallet] = useState(() => window.ethereum);
  const [contractAddress, setContractAddressState] = useState(
    () => localStorage.getItem(ADDRESS_STORAGE_KEY) ?? deployment.address ?? ""
  );
  const [error, setError] = useState(null);
  const [engineStatus, setEngineStatus] = useState({ state: "checking" });
  const [chainStatus, setChainStatus] = useState({ state: "checking" });
  const [minTrustScoreE4, setMinTrustScoreE4] = useState(null);
  const [requiredApprovals, setRequiredApprovals] = useState(null);
  const [lastProposalId, setLastProposalId] = useState("");
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const web3authRef = useRef(null);
  const [web3authReady, setWeb3authReady] = useState(false);

  const fallbackProvider = useMemo(() => {
    try {
      return new JsonRpcProvider(FALLBACK_RPC_URL);
    } catch {
      return null;
    }
  }, []);

  // Request test ETH and default consortium roles from trust-engine faucet
  const fundAccount = useCallback(async (addr) => {
    if (deployment.mode === "course") return { success: false, error: "Use an account funded on the Besu course chain." };
    if (!addr) return { success: false, error: "No target address" };
    try {
      const res = await fetch(`${TRUST_ENGINE_URL}/faucet`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: addr })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Faucet failed");
      return { success: true, ...data };
    } catch (err) {
      return { success: false, error: err.message };
    }
  }, []);
  const requestFaucet = (targetAddress = account) => fundAccount(targetAddress);

  useEffect(() => {
    if (injectedWallet) return;
    const detectWallet = () => {
      if (window.ethereum) setInjectedWallet(window.ethereum);
    };
    detectWallet();
    const timer = setInterval(detectWallet, 500);
    window.addEventListener("ethereum#initialized", detectWallet);
    return () => {
      clearInterval(timer);
      window.removeEventListener("ethereum#initialized", detectWallet);
    };
  }, [injectedWallet]);

  // Connect local dev wallet by index (0 = Deployer/Admin/Oracle, 1 = Station, 2 = Oracle 2)
  const connectDevWallet = useCallback(async (index = 0) => {
    if (deployment.mode === "course") return;
    setError(null);
    try {
      const wallet = getDemoWallet(index);
      const devSigner = wallet.connect(fallbackProvider);
      const addr = await devSigner.getAddress();
      const network = await fallbackProvider.getNetwork();
      if (Number(network.chainId) !== TARGET_CHAIN_ID) throw new Error(`Expected chain ${TARGET_CHAIN_ID}, got ${network.chainId}`);

      setProvider(fallbackProvider);
      setSigner(devSigner);
      setAccount(addr);
      setChainId(network.chainId.toString());
      setAuthMode("dev");

      localStorage.setItem(AUTH_MODE_STORAGE_KEY, "dev");
      localStorage.setItem(DEV_WALLET_INDEX_STORAGE_KEY, String(index));
      setIsLoginModalOpen(false);

      // Ensure account has funds & roles
      fundAccount(addr);
    } catch (err) {
      setError(err.message);
    }
  }, [fallbackProvider, fundAccount]);

  // Connect browser extension wallet (MetaMask, Rabby, Brave, Coinbase)
  const connectInjected = useCallback(async (interactive = true) => {
    setError(null);
    const ethereum = injectedWallet || window.ethereum;
    if (!ethereum) {
      setError("No injected browser wallet found. Install MetaMask or choose a Dev Account.");
      return null;
    }
    try {
      if (interactive) {
        await switchOrAddChain(ethereum, TARGET_CHAIN_ID, FALLBACK_RPC_URL);
      }

      // 2. Request accounts authorization explicitly
      let accounts;
      try {
        accounts = await ethereum.request({ method: interactive ? "eth_requestAccounts" : "eth_accounts" });
      } catch (authErr) {
        if (authErr.code === 4001) {
          throw new Error("Connection request cancelled in MetaMask.");
        }
        if (authErr.code === 4100 || authErr.message?.includes("authorized")) {
          throw new Error("Account authorization error: Please open MetaMask and connect your account to this site.");
        }
        throw authErr;
      }

      if (!accounts || accounts.length === 0) {
        if (!interactive) return null;
        throw new Error("No accounts authorized in MetaMask.");
      }

      const activeAccount = accounts[0];

      // 3. Create fresh BrowserProvider on the updated chain
      const browserProvider = new BrowserProvider(ethereum);
      const network = await browserProvider.getNetwork();
      if (Number(network.chainId) !== TARGET_CHAIN_ID) {
        throw new Error(`Switch your wallet to chain ${TARGET_CHAIN_ID} to connect.`);
      }
      const activeSigner = await browserProvider.getSigner(activeAccount);

      setProvider(browserProvider);
      setSigner(activeSigner);
      setAccount(activeAccount);
      setChainId(network.chainId.toString());
      setAuthMode("injected");

      localStorage.setItem(AUTH_MODE_STORAGE_KEY, "injected");
      setIsLoginModalOpen(false);

      if (interactive) fundAccount(activeAccount);
      return activeSigner;
    } catch (err) {
      const msg = err.shortMessage || err.message;
      setError(msg);
      return null;
    }
  }, [injectedWallet, fundAccount]);

  // Initialize Web3Auth (optional email / social embedded login)
  useEffect(() => {
    if (!WEB3AUTH_CLIENT_ID) return;

    let cancelled = false;
    try {
      const privateKeyProvider = new EthereumPrivateKeyProvider({
        config: { chainConfig: web3authChainConfig }
      });
      const web3auth = new Web3Auth({
        clientId: WEB3AUTH_CLIENT_ID,
        web3AuthNetwork: WEB3AUTH_NETWORK[WEB3AUTH_NETWORK_NAME.toUpperCase()] || WEB3AUTH_NETWORK.SAPPHIRE_DEVNET,
        chainConfig: web3authChainConfig,
        privateKeyProvider
      });
      web3authRef.current = web3auth;

      web3auth
        .initModal()
        .then(() => {
          if (cancelled) return;
          setWeb3authReady(true);
          const savedMode = localStorage.getItem(AUTH_MODE_STORAGE_KEY);
          if (savedMode === "web3auth" && web3auth.connected && web3auth.provider) {
            hydrateFromEip1193(web3auth.provider, "web3auth");
          }
        })
        .catch(() => {});
    } catch {}

    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hydrateFromEip1193 = useCallback(async (eip1193Provider, mode = "web3auth") => {
    try {
      const browserProvider = new BrowserProvider(eip1193Provider);
      const network = await browserProvider.getNetwork();
      if (Number(network.chainId) !== TARGET_CHAIN_ID) throw new Error(`Expected chain ${TARGET_CHAIN_ID}, got ${network.chainId}`);
      const activeSigner = await browserProvider.getSigner();
      const addr = await activeSigner.getAddress();

      setProvider(browserProvider);
      setSigner(activeSigner);
      setAccount(addr);
      setChainId(network.chainId.toString());
      setAuthMode(mode);
      localStorage.setItem(AUTH_MODE_STORAGE_KEY, mode);
      setIsLoginModalOpen(false);

      fundAccount(addr);
    } catch (err) {
      setError(err.shortMessage || err.message);
    }
  }, [fundAccount]);

  const connectWeb3Auth = useCallback(async () => {
    setError(null);
    const web3auth = web3authRef.current;
    if (!web3auth || !web3authReady) {
      setError("Web3Auth is still starting up or unavailable. Try MetaMask or Dev Account.");
      return;
    }
    try {
      const eip1193Provider = await web3auth.connect();
      await hydrateFromEip1193(eip1193Provider, "web3auth");
    } catch (err) {
      setError(err.shortMessage || err.message);
    }
  }, [web3authReady, hydrateFromEip1193]);

  // Auto-restore session on page reload
  useEffect(() => {
    const savedMode = localStorage.getItem(AUTH_MODE_STORAGE_KEY);
    if (!savedMode) return;

    if (savedMode === "dev") {
      const savedIndex = Number(localStorage.getItem(DEV_WALLET_INDEX_STORAGE_KEY) || 0);
      connectDevWallet(savedIndex);
    } else if (savedMode === "injected" && injectedWallet) {
      connectInjected(false);
    }
  }, [connectDevWallet, connectInjected, injectedWallet]);

  // Listen for injected wallet account/network changes
  useEffect(() => {
    if (!injectedWallet?.on) return;
    const refreshInjected = () => {
      if (localStorage.getItem(AUTH_MODE_STORAGE_KEY) !== "injected") return;
      setProvider(null);
      setSigner(null);
      setAccount(null);
      setChainId(null);
      setAuthMode(null);
      connectInjected(false);
    };

    injectedWallet.on("accountsChanged", refreshInjected);
    injectedWallet.on("chainChanged", refreshInjected);
    return () => {
      injectedWallet.removeListener?.("accountsChanged", refreshInjected);
      injectedWallet.removeListener?.("chainChanged", refreshInjected);
    };
  }, [injectedWallet, connectInjected]);

  // Default connect action: open the login modal to let user choose
  const connect = useCallback(() => {
    setIsLoginModalOpen(true);
  }, []);

  const disconnect = useCallback(async () => {
    setError(null);
    try {
      if (authMode === "web3auth") {
        await web3authRef.current?.logout();
      }
    } catch {}
    localStorage.removeItem(AUTH_MODE_STORAGE_KEY);
    localStorage.removeItem(DEV_WALLET_INDEX_STORAGE_KEY);
    setProvider(null);
    setSigner(null);
    setAccount(null);
    setChainId(null);
    setAuthMode(null);
  }, [authMode]);

  const setContractAddress = useCallback((addr) => {
    localStorage.setItem(ADDRESS_STORAGE_KEY, addr);
    setContractAddressState(addr);
  }, []);

  const readProvider = fallbackProvider;

  const contract = useMemo(() => {
    if (!signer || !contractAddress) return null;
    try {
      return new Contract(contractAddress, registryArtifact.abi, signer);
    } catch {
      return null;
    }
  }, [signer, contractAddress]);

  const readOnlyContract = useMemo(() => {
    if (!readProvider || !contractAddress) return null;
    try {
      return new Contract(contractAddress, registryArtifact.abi, readProvider);
    } catch {
      return null;
    }
  }, [readProvider, contractAddress]);

  // Poll the chain and the off-chain trust engine
  useEffect(() => {
    let cancelled = false;

    async function poll() {
      if (readProvider) {
        try {
          const network = await readProvider.getNetwork();
          const blockNumber = await readProvider.getBlockNumber();
          if (!cancelled) setChainStatus({ state: "live", chainId: network.chainId.toString(), blockNumber });
        } catch {
          if (!cancelled) setChainStatus({ state: "down" });
        }
      }

      if (readOnlyContract) {
        try {
          const [min, req] = await Promise.all([
            readOnlyContract.minTrustScoreE4(),
            readOnlyContract.requiredApprovals()
          ]);
          if (!cancelled) {
            setMinTrustScoreE4(Number(min));
            setRequiredApprovals(Number(req));
          }
        } catch {
          if (!cancelled) { setMinTrustScoreE4(null); setRequiredApprovals(null); }
        }
      }

      try {
        const res = await fetch(`${TRUST_ENGINE_URL}/health`);
        if (!res.ok) throw new Error("Trust engine unavailable");
        const body = await res.json();
        if (body.status !== "ok") throw new Error("Registry unavailable");
        if (!cancelled) setEngineStatus({ state: "live", ...body });
      } catch {
        if (!cancelled) setEngineStatus({ state: "down" });
      }
    }

    poll();
    const timer = setInterval(poll, 6000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [readProvider, readOnlyContract]);

  const hasInjectedWallet = Boolean(injectedWallet);

  const value = {
    provider, signer, account, chainId, error,
    authMode,
    hasWallet: (deployment.mode !== "course" && Boolean(fallbackProvider)) || hasInjectedWallet || web3authReady,
    hasInjectedWallet,
    web3authReady,
    isLoginModalOpen, setIsLoginModalOpen,
    contractAddress, setContractAddress,
    contract, readOnlyContract, fallbackProvider,
    connect, disconnect,
    connectInjected, connectDevWallet, connectWeb3Auth,
    requestFaucet,
    engineStatus, chainStatus,
    minTrustScoreE4, requiredApprovals,
    lastProposalId, setLastProposalId,
    deployment
  };

  return <Web3Ctx.Provider value={value}>{children}</Web3Ctx.Provider>;
}

export function useWeb3() {
  const ctx = useContext(Web3Ctx);
  if (!ctx) throw new Error("useWeb3 must be used within Web3Provider");
  return ctx;
}
