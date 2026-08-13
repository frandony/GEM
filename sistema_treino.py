"""
SISTEMA DE CLASSIFICAÇÃO E MONTAGEM DE TREINO
=============================================

Este sistema recebe as informações pessoais de um aluno e gera um treino
personalizado baseado em 163 exercícios classificados.

COMO USAR:
----------
1. Importe a classe SistemaDeTreino
2. Passe um dicionário com os dados do aluno para montar_treino()
3. O sistema retorna o perfil do aluno + treino completo

EXEMPLO:
--------
from sistema_treino import SistemaDeTreino
import pandas as pd

df = pd.read_csv('exercicios_classificados.csv')
sistema = SistemaDeTreino(df)

dados_aluno = {
    'idade': 28,
    'sexo': 'feminino',
    'peso': 62,
    'altura': 1.65,
    'nivel_condicionamento': 'iniciante',
    'ja_treinou': False,
    'lesoes': [],
    'condicoes_saude': [],
    'objetivo': 'hipertrofia',
    'dias_semana': 3,
    'tempo_sessao': 60,
    'equipamentos_disponiveis': ['academia_completa'],
    'prefere_intensidade': 'moderada',
    'trabalho': 'sedentario',
    'sono': 'bom',
    'estresse': 'moderado',
}

resultado = sistema.montar_treino(dados_aluno)
print(resultado['treino'])
