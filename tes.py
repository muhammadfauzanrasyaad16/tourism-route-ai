import osmnx as ox

G = ox.load_graphml("graph/diy_road_network.graphml")

lat, lon = -7.7956, 110.3695  # area Malioboro
node_id = ox.distance.nearest_nodes(G, lon, lat)
node_data = G.nodes[node_id]
print(f"Node terdekat: {node_id} (lat={node_data['y']:.5f}, lon={node_data['x']:.5f})")