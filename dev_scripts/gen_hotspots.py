import random

# Generate hotspots for block9_1 (b9101-b9164)
print("// hotspots for block9_1")
for i in range(1, 65):
    id_key = f"b91{i:02d}"
    yaw = round(random.uniform(-3.14, 3.14), 6)
    pitch = round(random.uniform(-1, 0.7), 6)
    print(f'        {{\n        "type": "bubble",\n        "id": "{id_key}",\n        "yaw": {yaw}, "pitch": {pitch}\n        }},')

print("\n// hotspots for block9_2")
# Generate hotspots for block9_2 (b9201-b9292)
for i in range(1, 93):
    id_key = f"b92{i:02d}"
    yaw = round(random.uniform(-3.14, 3.14), 6)
    pitch = round(random.uniform(-1, 0.7), 6)
    print(f'        {{\n        "type": "bubble",\n        "id": "{id_key}",\n        "yaw": {yaw}, "pitch": {pitch}\n        }},')
