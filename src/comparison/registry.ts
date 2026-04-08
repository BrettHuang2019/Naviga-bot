import type { FieldVerifier } from "./types.js";
import { billToNameIdVerifier } from "./fields/bill-to-name-id.js";
import { paymentAmountVerifier } from "./fields/payment-amount.js";
import { renewalDateVerifier } from "./fields/renewal-date.js";
import { subscriberClientNumberVerifier } from "./fields/subscriber-client-number.js";
import { subscriberNameVerifier } from "./fields/subscriber-name.js";

export const fieldVerifiers: FieldVerifier[] = [
  subscriberClientNumberVerifier,
  billToNameIdVerifier,
  subscriberNameVerifier,
  paymentAmountVerifier,
  renewalDateVerifier,
];
