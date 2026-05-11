{
  "check": {
    "checkNumber": "Extract the cheque/check number from the cheque area, usually a short number near the top or MICR line; return only the number.",
    "date": "Extract the cheque date from the cheque area and return it in ISO format YYYY-MM-DD when possible.",
    "payTo": "Extract the payee after PAYEZ A L'ORDRE DE / PAY TO THE ORDER OF; infer the closest match if handwritten text resembles Bayard Presse Canada Inc., Bayard Presse Canada, Bayard Jeunesse, Novalis, or Living with Christ, otherwise return the plain visible text.",
    "amountNumber": "Extract the numeric cheque amount from the cheque amount box; return digits with two decimals and no currency symbol.",
    "amountWords": "Extract the handwritten or printed cheque amount in words, including cents like 48/100, without unrelated security or bank text.",
    "payerName": "Extract the person or organization name from the cheque payer block, usually top-left of the cheque or signature/name area; exclude bank and payee names.",
    "payerAddress": "Extract the payer mailing address from the cheque payer block; include street, city, province/state, and postal/ZIP code when present."
  },
  "coupon": {
    "clientId": "Extract the subscriber/client ID from coupon text near labels like no de client, client, or #CLIENT; prefer the ID tied to the subscription recipient.",
    "clientName": "Extract the subscription recipient name from coupon text near Pour l'abonnement de / For subscription of; do not use parent or payer name unless it is the only client name.",
    "promoCode": "Extract the promo code, usually above or near the barcode and containing letters plus a year or numeric campaign segment; return exact uppercase code.",
    "optionAmount": "Extract the amount associated with the selected coupon option; prefer the option amount that matches the cheque amount paid, usually the only matching option.",
    "optionChosen": "Extract the selected subscription option label, such as 1 an, 2 ans, 1 year, or 2 years; if nothing is selected, use the option whose price matches the cheque amount paid.",
    "priceFromChosenOption": "Extract the final price printed on the selected option row after discounts and equals signs; return digits with two decimals.",
    "issuesFromChosenOption": "Extract the issue count from the selected option row, including combined terms like 22+4 exactly when printed.",
    "regularOrExtra": "Classify the selected option as regular or extra from the row wording; return regular unless the selected row explicitly says extra/supplemental."
  }
}
