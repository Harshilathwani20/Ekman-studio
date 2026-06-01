import json

# Load products.json
products_file = r'c:\Users\RP\new_dir\ekmanstudios1\clients\neelkanth\tours\showroom\products.json'

with open(products_file, 'r') as f:
    products = json.load(f)

# Update block13 entries from .jpg to .png
updated_count = 0
for key in products:
    image_path = products[key]['image']
    
    # Check if this is a block13 entry with .jpg extension
    if 'block13' in image_path and image_path.endswith('.jpg'):
        products[key]['image'] = image_path.replace('.jpg', '.png')
        updated_count += 1

# Save updated products.json
with open(products_file, 'w') as f:
    json.dump(products, f, indent=2)

print(f'✓ Updated {updated_count} block13 entries from .jpg to .png')
print()
print('Sample updated entries:')
count = 0
for key in products:
    if 'block13' in products[key]['image']:
        print(f'  {key}: {products[key]["image"]}')
        count += 1
        if count >= 10:
            break
