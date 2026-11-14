"""Build offline 129-square DEMs from Mapzen Terrain Tiles (Terrarium z12).
Uses the exact geographic projection retained by build-circuit-library.mjs.
Requires Pillow; downloads cached public tiles only during asset preparation.
"""
import concurrent.futures
import io
import json
import math
from pathlib import Path
import urllib.request
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / 'src/circuit-data/dem-cache'
OUT = ROOT / 'public/data/elevation'
CACHE.mkdir(parents=True, exist_ok=True)
OUT.mkdir(parents=True, exist_ok=True)
library = json.loads((ROOT / 'src/circuit-library.ts').read_text(encoding='utf-8').split('export const CIRCUIT_LIBRARY: CircuitPreset[] = ', 1)[1].strip().removesuffix(';'))
ZOOM, RES = 12, 129
WORLD = 256 * 2**ZOOM

def pixels(lon, lat):
    return ((lon + 180) / 360 * WORLD - .5,
            (1 - math.asinh(math.tan(math.radians(lat))) / math.pi) / 2 * WORLD - .5)

def tile(key):
    x, y = key
    name = CACHE / f'{ZOOM}-{x}-{y}.png'
    if not name.exists():
        hosts=['https://s3.amazonaws.com/elevation-tiles-prod','https://elevation-tiles-prod.s3.amazonaws.com','https://elevation-tiles-prod-eu.s3.eu-central-1.amazonaws.com']
        failure=None
        for host in hosts*2:
            try:
                with urllib.request.urlopen(f'{host}/terrarium/{ZOOM}/{x}/{y}.png', timeout=12) as response:
                    blob = response.read()
                Image.open(io.BytesIO(blob)).verify()
                name.write_bytes(blob)
                break
            except Exception as error:
                failure=error
        else:
            raise RuntimeError(f'DEM tile {ZOOM}/{x}/{y}: {failure}')
    return key, Image.open(name).convert('RGB')

def build(c):
    b, g = c['nativeBounds'], c['geography']
    size = max(500, max(b['maxX']-b['minX'], b['maxZ']-b['minZ']) * 1.35 + 150)
    ox, oz = (b['minX']+b['maxX']-size)/2, (b['minZ']+b['maxZ']-size)/2
    def geographic(x, z):
        return (g['longitude']+(x+g['offsetX'])/g['lengthCorrection']/111320/math.cos(math.radians(g['latitude'])),
                g['latitude']-(z+g['offsetZ'])/g['lengthCorrection']/111320)
    corners = [pixels(*geographic(ox+x*size, oz+z*size)) for x in [0,1] for z in [0,1]]
    keys = [(x,y) for x in range(math.floor(min(p[0] for p in corners)/256), math.floor(max(p[0] for p in corners)/256)+1)
                   for y in range(math.floor(min(p[1] for p in corners)/256), math.floor((max(p[1] for p in corners)+1)/256)+1)]
    # A one-pixel interpolation halo may cross the east tile boundary.
    keys += [(x+1,y) for x,y in keys if x == max(k[0] for k in keys)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        tiles = dict(pool.map(tile, sorted(set(keys))))
    def height(x,z):
        u,v = pixels(*geographic(x,z)); ix,iy = math.floor(u),math.floor(v); tx,tz=u-ix,v-iy
        values=[]
        for dx,dy in [(0,0),(1,0),(0,1),(1,1)]:
            px,py=ix+dx,iy+dy
            r,g,b=tiles[(px//256,py//256)].getpixel((px%256,py%256))
            values.append(r*256+g+b/256-32768)
        a,b,c,d=values
        return a*(1-tx)*(1-tz)+b*tx*(1-tz)+c*(1-tx)*tz+d*tx*tz
    heights=[height(ox+x*size/(RES-1),oz+z*size/(RES-1)) for z in range(RES) for x in range(RES)]
    # Symmetric local filtering removes raster steps without clipping elevation.
    for _ in range(2):
        old=heights[:]
        for z in range(1,RES-1):
            for x in range(1,RES-1):
                i=z*RES+x
                heights[i]=(old[i]*4+old[i-1]+old[i+1]+old[i-RES]+old[i+RES])/8
    # A vertical datum shift leaves real elevation differences intact.
    start=c['nativePoints'][0]
    datum=height(start['x'],start['z'])
    for z in range(RES):
        for x in range(RES):
            edge=min(x,z,RES-1-x,RES-1-z)/4
            t=max(0,min(1,edge)); fade=t*t*(3-2*t)
            i=z*RES+x; heights[i]=round((heights[i]-datum)*fade,3)
    data=dict(resolution=RES,size=size,originX=ox,originZ=oz,heights=heights,
              source='Mapzen Terrain Tiles / Terrarium z12',datumM=round(datum,3),accessedAt='2026-11-15',
              processing='bilinear resampling; 2 smoothing passes; start-point vertical datum; boundary fade')
    (OUT/f"{c['id']}.json").write_text(json.dumps(data,separators=(',',':')),encoding='utf-8')
    print(c['id'], 'terrain range', min(heights), max(heights), 'tiles',len(tiles),flush=True)

for circuit in library:
    build(circuit)
print('Built',len(library),'offline elevation presets',flush=True)
