"""Contrato de los prompts reales, sin red, claves de IA ni dependencia de Flask."""
import ast
import json
import unittest
from pathlib import Path
from types import SimpleNamespace

SOURCE = ast.parse((Path(__file__).resolve().parents[1] / 'servidor_cicsa.py').read_text())


class ClassificationPromptTests(unittest.TestCase):
    def run_route(self, name):
        fn = next(n for n in SOURCE.body if isinstance(n, ast.FunctionDef) and n.name == name)
        # Se ejecuta el controlador real; solo los decoradores/transporte están simulados.
        fn.decorator_list = []
        calls = []
        def call(*args, **kwargs):
            calls.append((args, kwargs))
            return {'productos': [{'nombre': 'Fresa congelada', 'importe': 100}]}
        ns = {'request': SimpleNamespace(get_json=lambda: {'image_base64': 'test', 'categorias': ['Congelados']}),
              'cats_de': lambda d: ', '.join(d['categorias']), 'get_client': lambda: None,
              'call_claude': call, 'jsonify': lambda d: d, 'json': json}
        exec(compile(ast.Module(body=[fn], type_ignores=[]), '<ruta-real>', 'exec'), ns)
        result = ns[name]()
        self.assertIn('productos', result)
        self.assertEqual(len(calls), 1)
        return calls[0][0][3], calls[0][1]

    def test_full_preserves_product_identity_and_commercial_prices(self):
        prompt, opts = self.run_route('leer_gasto_full')
        for text in ('Congelados', 'codigo_proveedor', 'tipo_alimento', 'importe_clasificacion',
                     'precio_unitario', 'No inventes', 'ClaveProdServ'):
            self.assertIn(text, prompt)
        self.assertGreaterEqual(opts['max_tokens'], 8000)

    def test_division_returns_individual_products_not_only_groups(self):
        prompt, opts = self.run_route('analizar_division')
        for text in ('"productos"', '"partidas"', 'codigo_proveedor', 'Congelados', 'No lo supongas'):
            self.assertIn(text, prompt)
        self.assertGreaterEqual(opts['max_tokens'], 8000)

    def test_default_categories_include_frozen(self):
        node = next(n for n in SOURCE.body if isinstance(n, ast.Assign)
                    and any(isinstance(t, ast.Name) and t.id == 'CATEGORIAS' for t in n.targets))
        self.assertIn('Congelados', ast.literal_eval(node.value))


if __name__ == '__main__':
    unittest.main()
