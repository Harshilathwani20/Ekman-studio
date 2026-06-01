import json
from collections import OrderedDict

# Load products.json
products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'

with open(products_file, 'r') as f:
    products = json.load(f)

# Sort by keys alphanumerically
sorted_products = OrderedDict(sorted(products.items()))

# Save sorted products back
with open(products_file, 'w') as f:
    json.dump(sorted_products, f, indent=2)

print('Products.json sorted in alphanumeric order')
print(f'Total entries: {len(sorted_products)}')
print()
print('First 10 entries:')
for key in list(sorted_products.keys())[:10]:
    img = sorted_products[key]['image']
    print(f'  {key}: {img}')
print()
print('Last 10 entries:')
for key in list(sorted_products.keys())[-10:]:
    img = sorted_products[key]['image']
    print(f'  {key}: {img}')
