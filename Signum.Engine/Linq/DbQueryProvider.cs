﻿using System;
using System.Collections;
using System.Collections.Generic;
using System.Collections.ObjectModel;
using System.Data.Common;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Text;
using System.Data.SqlClient;
using System.Diagnostics;
using Signum.Utilities.Reflection;
using Signum.Utilities.DataStructures;
using Signum.Utilities;
using Signum.Utilities.ExpressionTrees;
using Signum.Engine;
using System.Data;
using Signum.Entities;

namespace Signum.Engine.Linq
{

    /// <summary>
    /// Stateless query provider 
    /// </summary>
    public class DbQueryProvider : QueryProvider
    {       
        public static readonly DbQueryProvider Single = new DbQueryProvider();

        private DbQueryProvider()
        {
        }
    
        public override string GetQueryText(Expression expression)
        {
            return this.Translate(expression).CleanCommandText();
        }
        
        public override object Execute(Expression expression)
        {
            ITranslateResult tr = this.Translate(expression);

            return tr.Execute(null);
        }
     
        ITranslateResult Translate(Expression expression)
        {
            Expression cleaned = Clean(expression);
            Expression filtered = QueryFilterer.Filter(cleaned);
            ProjectionExpression binded = (ProjectionExpression)QueryBinder.Bind(filtered);
            ProjectionExpression optimized = (ProjectionExpression)Optimize(binded);

            ITranslateResult result = TranslatorBuilder.Build(optimized, null);
            return result; 
        }

        public static Expression Clean(Expression expression)
        {
            Expression expand = ExpressionExpander.Expand(expression, Clean);
            Expression eval =  ExpressionEvaluator.PartialEval(expand);
            Expression simplified = OverloadingSimplifier.Simplify(eval);

            return simplified;
        }

        internal static Expression Optimize(Expression binded)
        {
            Expression rewrited = AggregateRewriter.Rewrite(binded);
            Expression rebinded = QueryRebinder.Rebind(rewrited);
            Expression projCleaned = ProjectionCleaner.Clean(rebinded);
            Expression replaced = AliasProjectionReplacer.Replace(projCleaned);
            Expression columnCleaned = UnusedColumnRemover.Remove(replaced);
            Expression subqueryCleaned = RedundantSubqueryRemover.Remove(columnCleaned);
            return subqueryCleaned;
        }

        internal int Delete<T>(IQueryable<T> query)
            where T : IdentifiableEntity
        {
            Expression cleaned = Clean(query.Expression);
            Expression filtered = QueryFilterer.Filter(cleaned);
            CommandExpression delete = new QueryBinder().BindDelete(filtered);
            CommandExpression deleteOptimized = (CommandExpression)Optimize(delete);
            CommandResult cr = TranslatorBuilder.BuildCommandResult(deleteOptimized);

            return cr.Execute();
        }

        internal int Update<T>(IQueryable<T> query, Expression<Func<T, T>> set)
            where T : IdentifiableEntity
        {
            Expression cleaned = Clean(query.Expression);
            Expression filtered = QueryFilterer.Filter(cleaned);
            CommandExpression update = new QueryBinder().BindUpdate(filtered, set);
            CommandExpression updateOptimized = (CommandExpression)Optimize(update);
            CommandResult cr = TranslatorBuilder.BuildCommandResult(updateOptimized);

            return cr.Execute();
        }
    }
}
