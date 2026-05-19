import json
import graphviz
import textwrap
import html

# A color palette to visually distinguish the main ontology branches
COLOR_PALETTE = ['#d4e6f1', '#d1f2eb', '#fdebd0', '#ebdef0', '#e8daef', '#fadbd8', '#d6eaf8']

def adjust_color_brightness(hex_color, factor):
    """
    Adjusts the brightness of a hex color. A factor < 1.0 darkens it.
    Clamps values to stay within the valid 0-255 range.
    """
    if not hex_color.startswith('#'):
        return hex_color
    hex_color = hex_color.lstrip('#')
    rgb = tuple(int(hex_color[i:i+2], 16) for i in (0, 2, 4))
    new_rgb = [min(255, max(0, int(val * factor))) for val in rgb]
    return f"#{''.join([f'{v:02x}' for v in new_rgb])}"

def create_node_label(item, bgcolor):
    """Creates a rich, HTML-like label for a node with a colored title bar."""
    node_name = item.get('name', 'Unnamed Node')
    definition = item.get('definition', 'No definition available.')

    # Sanitize and wrap text for the HTML-like label
    wrapped_name = '<BR/>'.join(textwrap.wrap(html.escape(node_name), width=30))
    wrapped_definition = '<BR/>'.join(textwrap.wrap(html.escape(definition), width=60))

    label = f'''<<TABLE BORDER="0" CELLBORDER="1" CELLSPACING="0" CELLPADDING="5" STYLE="ROUNDED">
                    <TR><TD ALIGN="CENTER" BGCOLOR="{bgcolor}" BORDER="0"><B>{wrapped_name}</B></TD></TR>
                    <TR><TD ALIGN="LEFT" BALIGN="LEFT" BORDER="0">{wrapped_definition}</TD></TR>
                  </TABLE>>'''
    return label

def add_nodes_to_cluster(graph, data, parent=None, base_color='#ddebf7', depth=0):
    """
    Recursively adds nodes within a cluster with progressively darker colors.
    """
    for item in data:
        node_id = item['name']
        
        # Darken the color based on depth. The factor is capped to avoid making it too dark.
        brightness_factor = max(0.5, 1.0 - (depth * 0.08))
        node_bgcolor = adjust_color_brightness(base_color, brightness_factor)
        
        label = create_node_label(item, node_bgcolor)
        graph.node(node_id, label=label, shape='plaintext')
        
        if parent:
            graph.edge(parent, node_id)
        
        if 'children' in item and item['children']:
            add_nodes_to_cluster(graph, item['children'], parent=node_id, base_color=base_color, depth=depth + 1)

def main():
    """
    Main function to generate the ontology visualization with clustering and color coding.
    """
    try:
        with open('public/ontology_tree.json', 'r') as f:
            ontology_data = json.load(f)
    except FileNotFoundError:
        print("❌ Error: 'public/ontology_tree.json' not found.")
        return
    except json.JSONDecodeError:
        print("❌ Error: Could not decode JSON. Check for syntax errors.")
        return

    # Create the main graph
    dot = graphviz.Digraph('Ontology', comment='Policy Ontology Tree')
    dot.attr(rankdir='TB', size='100,100!', ratio='auto', splines='ortho', overlap='prism', nodesep='0.8', ranksep='1.5 equally')
    dot.attr('node', fontname='Helvetica', fontsize='12')
    dot.attr('edge', arrowhead='vee', arrowsize='0.8')

    if not ontology_data:
        print("❌ Error: Ontology data is empty.")
        return
    
    root_data = ontology_data[0]
    root_name = root_data['name']

    root_label = create_node_label(root_data, bgcolor='#a9cce3')
    dot.node(root_name, label=root_label, shape='plaintext')

    if 'children' in root_data and root_data['children']:
        for i, category in enumerate(root_data['children']):
            category_name = category['name']
            color = COLOR_PALETTE[i % len(COLOR_PALETTE)]
            cluster_name = f'cluster_{i}'
            
            with dot.subgraph(name=cluster_name) as c:
                c.attr(label=category_name, style='filled,rounded', color=f'{color}', penwidth='2', labeljust='l', fontname='Helvetica-Bold', fontsize='20', fontcolor='#333333')
                
                # The top node of the category uses the base color (depth=0)
                category_label = create_node_label(category, bgcolor=color)
                c.node(category_name, label=category_label, shape='plaintext')
                
                # Recursively add children, starting at depth 1 for shading
                if 'children' in category and category['children']:
                    add_nodes_to_cluster(c, category['children'], parent=category_name, base_color=color, depth=1)
            
            dot.edge(root_name, category_name)

    output_filename = 'ontology_visualization'
    try:
        dot.render(output_filename, format='svg', view=False, cleanup=True)
        print(f"✅ Successfully generated '{output_filename}.svg'")
        
        dot.graph_attr['dpi'] = '300'
        dot.render(output_filename, format='png', view=False, cleanup=True)
        print(f"✅ Successfully generated '{output_filename}.png'")
        
        dot.render(output_filename, format='pdf', view=False, cleanup=True)
        print(f"✅ Successfully generated '{output_filename}.pdf'")
        
        print(f"\n✨ DONE! Your new, easy-to-read visualizations are ready.")
        print(f"   For best results, open '{output_filename}.pdf' or '{output_filename}.svg'.")

    except graphviz.backend.ExecutableNotFound:
        print("\n❌ ERROR: Graphviz software not found. Please install it and try again.")
    except Exception as e:
        print(f"❌ An unexpected error occurred: {e}")

if __name__ == '__main__':
    main()
