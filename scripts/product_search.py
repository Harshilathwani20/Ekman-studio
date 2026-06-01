import cv2
import numpy as np
import json
import os

# --- CONFIG ---
import pathlib
BASE = pathlib.Path(__file__).parent.parent / 'clients' / 'neelkanth' / 'tours' / 'showroom'
PRODUCT_ID = 'b201'
BLOCK_JSON = str(BASE / 'block2.json')
PRODUCTS_JSON = str(BASE / 'products.json')
SCENE_IMAGE = str(BASE / 'panos' / 'block2.jpeg')

# --- LOAD PRODUCT IMAGE PATH ---
with open(PRODUCTS_JSON, 'r') as f:
    products = json.load(f)
product_img_path = str(BASE / products[PRODUCT_ID]['image'])

# --- LOAD IMAGES ---
object_img = cv2.imread(product_img_path, 0)
panorama = cv2.imread(SCENE_IMAGE, 0)
if object_img is None:
    raise FileNotFoundError(f'Product image not found: {product_img_path}')
if panorama is None:
    raise FileNotFoundError(f'Scene image not found: {SCENE_IMAGE}')

# --- ORB FEATURE MATCHING ---
orb = cv2.ORB_create()
kp1, des1 = orb.detectAndCompute(object_img, None)
kp2, des2 = orb.detectAndCompute(panorama, None)
bf = cv2.BFMatcher(cv2.NORM_HAMMING, crossCheck=True)
matches = bf.match(des1, des2)
matches = sorted(matches, key=lambda x: x.distance)

# --- HOMOGRAPHY & LOCATION ---
if len(matches) > 10:
    src_pts = np.float32([kp1[m.queryIdx].pt for m in matches[:30]]).reshape(-1,1,2)
    dst_pts = np.float32([kp2[m.trainIdx].pt for m in matches[:30]]).reshape(-1,1,2)
    M, mask = cv2.findHomography(src_pts, dst_pts, cv2.RANSAC, 5.0)
    if M is not None:
        h, w = object_img.shape
        pts = np.float32([[0,0],[0,h],[w,h],[w,0]]).reshape(-1,1,2)
        dst = cv2.perspectiveTransform(pts, M)
        # Center of detected region
        center = np.mean(dst, axis=0)[0]
        x, y = center
        # Convert x, y to yaw, pitch (simple mapping, needs calibration for real 360)
        pano_h, pano_w = panorama.shape
        yaw = (x / pano_w) * 2 * np.pi - np.pi
        pitch = (y / pano_h) * np.pi - (np.pi/2)
        print(f'Product {PRODUCT_ID} detected at yaw: {yaw:.4f}, pitch: {pitch:.4f}')
        # Draw detected region
        panorama_color = cv2.cvtColor(panorama, cv2.COLOR_GRAY2BGR)
        cv2.polylines(panorama_color, [np.int32(dst)], True, (0,255,0), 3)
        cv2.imshow('Detected', panorama_color)
        cv2.waitKey(0)
        cv2.destroyAllWindows()
    else:
        print('Homography not found, product not detected.')
else:
    print('Not enough matches found, product not detected.')
