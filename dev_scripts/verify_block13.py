import json

products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'

with open(products_file, 'r') as f:
    products = json.load(f)

b13_entries = sorted([k for k in products.keys() if k.startswith('b13')])

print('Block13 entries:')
print()
print('First 5:')
for k in b13_entries[:5]:
    print(f'  {k}: {products[k]["image"]}')

print()
print('Last 5:')
for k in b13_entries[-5:]:
    print(f'  {k}: {products[k]["image"]}')

print()
print(f'Total: {len(b13_entries)} entries')
