
# Check
1. check num 
2. date - maximum 3 months from today's date. 
3. Pay to - only following bussiness names are accepted: 
- Bayard Presse Canada Inc. 
- Bayard Presse Canada
- Bayard Jeunesse
- Novalis  
- Living with christ
4. price in number
5. price in words.
6. name
7. address

# Coupon
1. Client id 
2. Client name 
3. Promo code (usually located above barcode, contains letters and year number in middle) 
4. Option chosen (some has 2 options, some has 1 only, some has 3)
5. Price from chosen option
6. numéros from chosen option (what about 22+4?) 
7. Regular or Extra

# Human create Batch

# Naviga - Query user in batch
1. Input Promo code 
if Regular - R, if extra - X

2. Input Term (what is the rule for 22+4?)
create a list.
PGC - 12/24
DEB - 10/20
PASP - 6/12
CUR - 9/18
LIT - 6/12

3. Paid, check

Update

# Naviga - Get info from add renewal in a test batch
1. name
2. address
3. cliend number
4. promo code 
5. duration (1 an, 2 ans)
6. price

# Validate: 
1. Client name
- naviga = coupon , if no, error
- naviga = coupon = check , if no, warning 
2. Client number
- naviga = coupon  , if no, error
3. address 
- naviga = coupon = check, if no, warning
4. price
- naviga = coupon = check, if no, error
(on check)
- price in number = price in words, if no warning.

# Action:
if no error - add to batch workflow.
 


npm run dev -- add-subscription-to-batch --env:NAVIGA_PROMO_CODE=DEB2600AV3 --coupon-extract artifacts\cases\2026-04-15T18-51-13Z_993764\coupon-extract.json
