// بردارهای آزمون را خود برنامهٔ دسکتاپ (hbb_common::tcp::Encrypt و sodiumoxide) ساخته است؛
// رمزنگاری مرورگر باید بایت‌به‌بایت همان را بدهد (docs/ASANDESK-WEB.md، «آزمون‌ها»)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import nacl from 'tweetnacl';
import { StreamCipher, sealKey, openKey, openSigned, signCombined, signKeyPairFromSeed } from '../src/net/crypto.ts';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const enc = (s: string) => new TextEncoder().encode(s);

const RUST = {
  init_pk: '5dfedd3b6bd47f6fa28ee15d969d5bb0ea53774d488bdaf9df1c6e0124b3ef22',
  resp_pk: 'ac01b2209e86354fb853237b5de0f4fab13c7fcbf433a61c019369617fecf10b',
  v1_init_1: '2ffe6068eb4d2ab8811172d55b80a5b5a1f853116d425e39178b23817165',
  v1_init_2: '434d570afb6ea88514a764721c497f7c4f834cbaf84e9525497f19cddc27',
  v1_resp_1: 'd74d979222984701f88e52c3f15af60985d150257eedd4784953944d7dc1',
  v0_1: '6ca3cd135e7f0ff599214acf03f07370fd4689f7c884a801239cf82307da',
  sealed: 'e5b2a6202eafaa88dc2d4b7247b7b0f4a5463be6db31f9f57b80ce0d3a7a51a6b826548c66d795612e03ef00846deded',
  sign_pk: '6e7a1cdd29b0b78fd13af4c5598feff4ef2a97166e3ca6f2e4fbfccd80505bf1',
  signed: '2f972b1547eee79788f358448e5aef88781ceac93849d974c9824870a162a3fd91b0b8af1e2d71ef318e717c321cfe8c5002c98017b4f15b5f2b62ce7e9f760d6964706b2d6279746573',
};

const key = Uint8Array.from({ length: 32 }, (_, i) => i + 1);
const init = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(3));
const resp = nacl.box.keyPair.fromSecretKey(new Uint8Array(32).fill(4));
const transcript = { initiatorPk: init.publicKey, responderPk: resp.publicKey, advertised: 1, picked: 1 };

test('key exchange version 1 matches the desktop app', () => {
  assert.equal(hex(init.publicKey), RUST.init_pk);
  assert.equal(hex(resp.publicKey), RUST.resp_pk);
  const initiator = StreamCipher.negotiated(key, true, transcript);
  assert.equal(hex(initiator.encrypt(enc('hello asandesk'))), RUST.v1_init_1);
  assert.equal(hex(initiator.encrypt(enc('second message'))), RUST.v1_init_2);
  const responder = StreamCipher.negotiated(key, false, transcript);
  assert.equal(hex(responder.encrypt(enc('from responder'))), RUST.v1_resp_1);
  // و هر طرف پیام طرف دیگر را باز می‌کند
  const r2 = StreamCipher.negotiated(key, false, transcript);
  assert.equal(new TextDecoder().decode(r2.decrypt(Buffer.from(RUST.v1_init_1, 'hex'))), 'hello asandesk');
});

test('original key exchange (version 0) matches the desktop app', () => {
  const c = StreamCipher.negotiated(key, true, { ...transcript, advertised: 0, picked: 0 });
  assert.equal(hex(c.encrypt(enc('hello asandesk'))), RUST.v0_1);
});

test('sealed key and signed identity match the desktop app', () => {
  assert.equal(hex(sealKey(key, resp.publicKey, init.secretKey)), RUST.sealed);
  assert.deepEqual(openKey(Buffer.from(RUST.sealed, 'hex'), init.publicKey, resp.secretKey), key);
  const kp = signKeyPairFromSeed(new Uint8Array(32).fill(5));
  assert.equal(hex(kp.publicKey), RUST.sign_pk);
  assert.equal(hex(signCombined(enc('idpk-bytes'), kp.secretKey)), RUST.signed);
  assert.equal(new TextDecoder().decode(openSigned(Buffer.from(RUST.signed, 'hex'), kp.publicKey)!), 'idpk-bytes');
});
