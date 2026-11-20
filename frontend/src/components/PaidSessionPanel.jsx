import React, { useEffect, useState } from "react";
import { formatEther, getBytes, hexlify, isHexString, parseEther, randomBytes, verifyMessage } from "ethers";
import { useWeb3 } from "../Web3Context.jsx";
import { toDidHash } from "../utils/didHash.js";
import { buildMeterDigest, buildSessionDigest, readSessionEvent } from "../utils/signSession.js";
import { formatErrorMessage } from "../utils/formatError.js";
import { Card, Field, Message, CopyChip, shorten } from "./ui.jsx";
import courseStationDids from "../courseStationDids.json";

const paymentStates = ["Authorized", "Funded", "Settled", "Refunded"];
const defaultEvDid = "did:ev:001";
const knownStationDids = new Map(courseStationDids.map((did) => [toDidHash(did), did]));

export default function PaidSessionPanel({ role = "settlement" }) {
  const { account, signer, contract, readOnlyContract, contractAddress, deployment } = useWeb3();
  const customerPage = role === "customer";
  const ownerPage = role === "station";
  const [evDidInput, setEvDid] = useState(() => new URLSearchParams(window.location.search).get("evDid") || null);
  const [walletIdentity, setWalletIdentity] = useState(null);
  const [stationHash, setStationHash] = useState(toDidHash("did:station:001"));
  const [stationOptions, setStationOptions] = useState([]);
  const [stationStatus, setStationStatus] = useState("Loading registered stations…");
  const [challengeText, setChallengeText] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [maxWh, setMaxWh] = useState("1000");
  const [priceEthPerWh, setPriceEthPerWh] = useState("0.00001");
  const [energyWh, setEnergyWh] = useState("380");
  const [meterText, setMeterText] = useState("");
  const [details, setDetails] = useState(null);
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);

  const resolvedDid = walletIdentity?.account === account ? walletIdentity?.did : null;
  const evDid = evDidInput ?? resolvedDid ?? defaultEvDid;
  const findingEv = evDidInput === null && Boolean(account && readOnlyContract) && !resolvedDid;
  const selectedStation = stationOptions.find((station) => station.hash === stationHash) ?? stationOptions[0];

  useEffect(() => {
    if (ownerPage || evDidInput !== null || !account || !readOnlyContract) return;
    let cancelled = false;
    const normalizedAccount = account.toLowerCase();
    const candidate = `did:ev:${normalizedAccount.slice(2)}`;
    const hash = toDidHash(candidate);
    Promise.all([readOnlyContract.entities(hash), readOnlyContract.revoked(hash)])
      .then(([entity, revoked]) => {
        if (cancelled) return;
        const matches = entity.registered && !entity.isStation && !revoked && entity.pubKey.toLowerCase() === normalizedAccount;
        setWalletIdentity({ account, did: matches ? candidate : defaultEvDid });
      })
      .catch(() => {
        if (!cancelled) setWalletIdentity({ account, did: defaultEvDid });
      });
    return () => { cancelled = true; };
  }, [account, readOnlyContract, evDidInput, ownerPage]);

  useEffect(() => {
    if (ownerPage || !readOnlyContract) return;
    let cancelled = false;

    async function loadStations() {
      const filter = readOnlyContract.filters.Registered();
      const first = deployment.blockNumber ?? 0;
      const head = await readOnlyContract.runner.getBlockNumber();
      const stationHashes = new Set();
      for (let start = first; start <= head && !cancelled; start += 2000) {
        const events = await readOnlyContract.queryFilter(filter, start, Math.min(head, start + 1999));
        for (const event of events) {
          if (event.args.isStation) stationHashes.add(event.args.didHash);
        }
      }
      if (cancelled) return;
      const options = await Promise.all([...stationHashes].map(async (hash) => {
        const [entity, revoked] = await Promise.all([
          readOnlyContract.entities(hash), readOnlyContract.revoked(hash)
        ]);
        if (!entity.registered || !entity.isStation || revoked) return null;
        return { hash, label: knownStationDids.get(hash) ?? `Station ${shorten(hash)} (${shorten(entity.pubKey)})` };
      }));
      if (cancelled) return;
      const active = options.filter(Boolean).sort((a, b) => a.label.localeCompare(b.label));
      setStationOptions(active);
      setStationStatus(active.length ? "" : "No active stations registered");
    }

    loadStations().catch(() => {
      if (!cancelled) setStationStatus("Could not load registered stations");
    });
    return () => { cancelled = true; };
  }, [readOnlyContract, deployment.blockNumber, ownerPage]);

  async function run(action, needsSigner = true) {
    setBusy(true);
    setStatus(null);
    try {
      if (!readOnlyContract) throw new Error("The registry is unavailable.");
      if (needsSigner && (!signer || !contract)) throw new Error("Connect the matching wallet first.");
      await action();
    } catch (error) {
      setStatus({ kind: "bad", text: formatErrorMessage(error, contract || readOnlyContract) });
    } finally {
      setBusy(false);
    }
  }

  function notice(text) {
    setStatus({ kind: "ok", text });
  }

  async function refresh(id = sessionId) {
    if (!isHexString(id, 32)) throw new Error("Enter a 32-byte session ID.");
    const [session, balance] = await Promise.all([
      readOnlyContract.chargingSessions(id), account ? readOnlyContract.withdrawable(account) : 0n
    ]);
    if (/^0x0{40}$/i.test(session.evAccount)) throw new Error("No authorized session found for that ID.");
    setDetails({ session, balance });
    return session;
  }

  async function findCustomerSession() {
    if (!account) throw new Error("Connect your EV wallet to find its latest session.");
    const evId = toDidHash(evDid);
    const filter = readOnlyContract.filters.SessionAuthenticated(evId);
    const deploymentBlock = deployment.blockNumber ?? 0;
    let end = await readOnlyContract.runner.getBlockNumber();
    while (end >= deploymentBlock) {
      const start = Math.max(deploymentBlock, end - 1999);
      const events = await readOnlyContract.queryFilter(filter, start, end);
      for (const event of events.reverse()) {
        const id = event.args.sessionId;
        const session = await readOnlyContract.chargingSessions(id);
        if (session.evAccount.toLowerCase() !== account.toLowerCase()) continue;
        await refresh(id);
        setSessionId(id);
        notice(`Latest session loaded. Status ${paymentStates[Number(session.paymentState)].toLowerCase()}.`);
        return;
      }
      end = start - 1;
    }
    throw new Error("No authorized session found for this EV DID and wallet. Ask the station owner to authorize your challenge.");
  }

  async function createChallenge() {
    if (!selectedStation) throw new Error("Choose a registered station first.");
    const packet = { evId: toDidHash(evDid), stationId: selectedStation.hash, nonce: hexlify(randomBytes(32)) };
    const [ev, revoked] = await Promise.all([
      readOnlyContract.entities(packet.evId), readOnlyContract.revoked(packet.evId)
    ]);
    if (!ev.registered || ev.isStation || revoked) throw new Error(`${evDid} is not an active EV identity.`);
    if (ev.pubKey.toLowerCase() !== account.toLowerCase()) {
      throw new Error(`Switch MetaMask to ${ev.pubKey}, the wallet registered to ${evDid}. Connected wallet: ${account}.`);
    }
    const digest = buildSessionDigest(packet.evId, packet.stationId, packet.nonce, contractAddress, deployment.chainId);
    packet.evSig = await signer.signMessage(getBytes(digest));
    setChallengeText(JSON.stringify(packet));
    notice("Share this signed challenge with the station.");
  }

  async function authorizeChallenge() {
    const packet = JSON.parse(challengeText);
    const digest = getBytes(buildSessionDigest(packet.evId, packet.stationId, packet.nonce, contractAddress, deployment.chainId));
    const [ev, station] = await Promise.all([readOnlyContract.entities(packet.evId), readOnlyContract.entities(packet.stationId)]);
    if (!ev.registered || ev.isStation || verifyMessage(digest, packet.evSig) !== ev.pubKey) throw new Error("Invalid EV signature.");
    if (!station.registered || !station.isStation) throw new Error("The requested station is not registered.");
    if (station.pubKey.toLowerCase() !== account.toLowerCase()) {
      throw new Error(`Switch MetaMask to ${station.pubKey}, the wallet registered to the requested station. Connected wallet: ${account}.`);
    }
    const stationSig = await signer.signMessage(digest);
    const tx = await contract.authenticateSession(packet.evId, packet.stationId, packet.nonce, packet.evSig, stationSig);
    const result = readSessionEvent(contract, await tx.wait());
    if (!result.authorized) throw new Error("Both trust scores must meet the registry threshold.");
    setSessionId(result.sessionId);
    await refresh(result.sessionId);
    notice("Session authorized. Share its ID with the EV to fund it.");
  }

  async function fund() {
    const session = await refresh();
    if (session.evAccount.toLowerCase() !== account.toLowerCase()) throw new Error("Switch to the wallet registered for the EV.");
    const limit = BigInt(maxWh);
    const price = parseEther(priceEthPerWh);
    if (limit <= 0n || price <= 0n) throw new Error("Enter a positive energy budget and unit price.");
    const expires = (await readOnlyContract.runner.getBlock("latest")).timestamp + 3600;
    await (await contract.fundSession(sessionId, limit, price, expires, { value: limit * price })).wait();
    await refresh();
    notice("Budget locked for one hour. Share the session ID before signing the meter reading.");
  }

  async function signMeter() {
    const session = await refresh();
    if (session.paymentState !== 1n) throw new Error("Fund the session before signing a meter reading.");
    const isEv = account.toLowerCase() === session.evAccount.toLowerCase();
    const isStation = account.toLowerCase() === session.stationAccount.toLowerCase();
    if (customerPage && !isEv) throw new Error(`Connect the customer wallet ${session.evAccount} to sign this reading.`);
    if (ownerPage && !isStation) throw new Error(`Connect the station wallet ${session.stationAccount} to sign this reading.`);
    if (!isEv && !isStation) throw new Error("Connect the EV or station wallet.");
    const signingAsEv = isEv && !ownerPage;
    if (customerPage && !meterText.trim()) throw new Error("Paste the signed meter packet from the station owner first.");
    const packet = meterText.trim() ? JSON.parse(meterText) : { sessionId, energyWh };
    if (packet.sessionId !== sessionId) throw new Error("Meter packet belongs to a different session.");
    if (customerPage && !packet.stationSig) throw new Error("Ask the station owner to sign this meter packet first.");
    const total = BigInt(packet.energyWh);
    if (total < 0n || total > session.maxWh) throw new Error("Energy exceeds the funded budget.");
    const digest = getBytes(buildMeterDigest(sessionId, total, session, contractAddress, deployment.chainId));
    const otherSignature = signingAsEv ? packet.stationSig : packet.evSig;
    if (otherSignature && verifyMessage(digest, otherSignature) !== (signingAsEv ? session.stationAccount : session.evAccount)) {
      throw new Error("Invalid signature in the meter packet.");
    }
    if (signingAsEv) packet.evSig = await signer.signMessage(digest);
    else packet.stationSig = await signer.signMessage(digest);
    setMeterText(JSON.stringify(packet));
    const nextRole = signingAsEv ? "station" : "EV";
    const nextWallet = signingAsEv ? session.stationAccount : session.evAccount;
    if (packet.evSig && packet.stationSig) {
      notice(customerPage ? "Both signatures are ready. Copy the packet and send it back to the station owner." : "Both signatures are ready. Click Settle payment.");
    } else {
      notice(ownerPage ? "Copy the signed meter packet and send it to the customer."
        : `Share this signed meter packet with the other participant, or switch to the ${nextRole} wallet ${nextWallet} in this tab. Then click Sign meter reading again.`);
    }
  }

  async function settle() {
    if (!meterText.trim()) throw new Error(ownerPage
      ? "Paste the meter packet with both signatures from the customer."
      : "Click Sign meter reading with the EV wallet, then switch to the station wallet and sign the same reading.");
    const packet = JSON.parse(meterText);
    if (packet.sessionId !== sessionId) throw new Error("This meter packet belongs to a different session. Load its Session ID or use the packet for the current session.");
    if (!packet.evSig && !packet.stationSig) throw new Error("This reading still needs both signatures. Click Sign meter reading once with each wallet.");
    if (!packet.evSig || !packet.stationSig) {
      const role = packet.evSig ? "station" : "EV";
      const session = await refresh();
      const wallet = packet.evSig ? session.stationAccount : session.evAccount;
      throw new Error(`The ${role} signature is missing. Switch to ${wallet} and click Sign meter reading again. Keep the existing meter packet.`);
    }
    await (await contract.settleSession(sessionId, BigInt(packet.energyWh), packet.evSig, packet.stationSig)).wait();
    await refresh();
    notice("Settlement confirmed. The station can withdraw its payment and the EV can withdraw the unused budget.");
  }

  let signedEnergyWh;
  try {
    const packet = meterText.trim() && JSON.parse(meterText);
    if (packet?.sessionId === sessionId && /^\d+$/.test(String(packet.energyWh))) signedEnergyWh = String(packet.energyWh);
  } catch {
    // Let the signing or settlement action report errors in pasted packets.
  }

  return (
    <div className="stack">
      {customerPage && <h2>Customer</h2>}
      {ownerPage && <h2>Station Owner</h2>}
      <div aria-live="polite">{status && <Message kind={status.kind}>{status.text}</Message>}</div>
      <Card title="Mutual authentication">
        {!ownerPage && <div className="field-row">
          <Field label="EV DID"><input type="text" value={evDid} onChange={(e) => setEvDid(e.target.value)} /></Field>
          <Field label="Station DID">
            <select className="station-select" aria-label="Station DID" value={selectedStation?.hash ?? ""} disabled={!stationOptions.length}
              onChange={(e) => setStationHash(e.target.value)}>
              {!selectedStation && <option value="">{stationStatus}</option>}
              {stationOptions.map(({ hash, label }) => <option key={hash} value={hash} title={hash}>{label}</option>)}
            </select>
          </Field>
        </div>}
        {customerPage && <p>Sign the challenge, then copy it to the station owner.</p>}
        {ownerPage && <p>Paste the customer's signed challenge. Authorize it and send the Session ID back to the customer.</p>}
        <Field label="Signed challenge packet"><textarea rows={3} value={challengeText} onChange={(e) => setChallengeText(e.target.value)} /></Field>
        <div className="actions">
          {!ownerPage && <button type="button" disabled={busy || findingEv || !selectedStation} onClick={() => run(createChallenge)}>Sign as EV</button>}
          {!customerPage && <button type="button" disabled={busy} onClick={() => run(authorizeChallenge)}>Countersign and authorize as station</button>}
          {!ownerPage && challengeText && <CopyChip value={challengeText} label="Copy challenge" />}
        </div>
      </Card>
      <Card title="Charging budget and payment">
        <Field label="Authorized session ID"><input type="text" value={sessionId} onChange={(e) => { setSessionId(e.target.value.trim()); setDetails(null); }} /></Field>
        {customerPage && <p>Paste the Session ID from the station owner or find your latest authorized session.</p>}
        <div className="actions">
          <button type="button" className="secondary" disabled={busy} onClick={() => run(() => refresh(), false)}>Load session</button>
          {customerPage && <button type="button" className="secondary" disabled={busy || findingEv || !account || !readOnlyContract}
            onClick={() => run(findCustomerSession, false)}>Find my latest session</button>}
          {sessionId && <CopyChip value={sessionId} label="Copy session ID" />}
          {details && <span>{paymentStates[Number(details.session.paymentState)]} · Withdrawable {formatEther(details.balance)} ETH</span>}
        </div>
        {details?.session.expiresAt > 0n && (
          <p>Funded terms {details.session.maxWh.toString()} Wh at {formatEther(details.session.pricePerWh)} ETH per Wh.
            Expires {new Date(Number(details.session.expiresAt) * 1000).toLocaleString()}.</p>
        )}
        {!ownerPage && <div className="field-row">
          <Field label="Energy budget (Wh)"><input type="number" min="1" value={maxWh} onChange={(e) => setMaxWh(e.target.value)} /></Field>
          <Field label="Price (ETH per Wh)"><input type="text" inputMode="decimal" value={priceEthPerWh} onChange={(e) => setPriceEthPerWh(e.target.value)} /></Field>
          <button type="button" disabled={busy} onClick={() => run(fund)}>Fund as EV</button>
        </div>}
        {!customerPage && <Field label="Delivered energy (Wh)"><input type="number" min="0" value={signedEnergyWh ?? energyWh} readOnly={signedEnergyWh !== undefined} onChange={(e) => setEnergyWh(e.target.value)} /></Field>}
        {customerPage && signedEnergyWh !== undefined && <p>Meter reading {signedEnergyWh} Wh</p>}
        <Field label="Signed meter packet"><textarea rows={3} value={meterText} onChange={(e) => setMeterText(e.target.value)} /></Field>
        <p>{customerPage ? "Paste the station owner's signed meter packet, check the energy, then sign it and return the packet."
          : ownerPage ? "After funding, enter the delivered energy and sign the meter reading. Send the packet to the customer, then paste the returned packet to settle."
            : "Sign the same meter packet with both wallets. Keep it in this box when switching accounts."}</p>
        <div className="actions">
          <button type="button" disabled={busy} onClick={() => run(signMeter)}>Sign meter reading</button>
          {meterText && <CopyChip value={meterText} label="Copy meter packet" />}
          {!customerPage && <button type="button" disabled={busy} onClick={() => run(settle)}>Settle payment</button>}
          {!ownerPage && <button type="button" className="secondary" disabled={busy} onClick={() => run(async () => {
            await (await contract.refundExpiredSession(sessionId)).wait();
            await refresh();
            notice("Expired budget refunded to the EV.");
          })}>Refund expired budget</button>}
          <button type="button" className="secondary" disabled={busy} onClick={() => run(async () => {
            await (await contract.withdrawPayments()).wait();
            if (isHexString(sessionId, 32)) await refresh();
            notice("Withdrawal confirmed.");
          })}>{customerPage ? "Withdraw EV refund" : ownerPage ? "Withdraw station payment" : "Withdraw funds"}</button>
        </div>
      </Card>
    </div>
  );
}
