
# Check
1. check num 
2. date - maximum 3 months from today's date. 
3. Pay to - only following bussiness names are accepted: 
- Bayard Presse Canada Inc. 
- Bayard Presse Canada
- Bayard Jeunesse
- Novalis  
- Living with christ
1. price in number = price in words.
2. name
3. address

# Coupon
1. Client id 
2. Client name 
3. Promo code above barcode 
4. Option chosen
5. Price from chosen option

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

# Action:
if no error - add to batch workflow.
 