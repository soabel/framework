﻿using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Reflection;
using System.Web;
using Newtonsoft.Json;
using Signum.Engine.Basics;
using Signum.Engine.Maps;
using Signum.Entities;
using Signum.Entities.Reflection;
using Signum.React.ApiControllers;
using Signum.Utilities;
using Signum.Entities.DynamicQuery;

namespace Signum.React.Facades
{
    public static class ReflectionCache
    {
        public static ConcurrentDictionary<CultureInfo, Dictionary<string, TypeInfoTS>> cache =
         new ConcurrentDictionary<CultureInfo, Dictionary<string, TypeInfoTS>>();

        public static Dictionary<Assembly, HashSet<string>> EntityAssemblies;

        internal static void Start()
        {
            DescriptionManager.Invalidated += () => cache.Clear();

            EntityAssemblies = TypeLogic.TypeToEntity.Keys.AgGroupToDictionary(t => t.Assembly, gr => gr.Select(a => a.Namespace).ToHashSet());
            EntityAssemblies[typeof(PaginationMode).Assembly].Add(typeof(PaginationMode).Namespace);
        }
        
        const BindingFlags instanceFlags = BindingFlags.Public | BindingFlags.Instance | BindingFlags.DeclaredOnly;
        const BindingFlags staticFlags = BindingFlags.Public | BindingFlags.Static | BindingFlags.DeclaredOnly;

        internal static Dictionary<string, TypeInfoTS> GetTypeInfoTS(CultureInfo culture)
        {
            return cache.GetOrAdd(culture, ci =>
            {
                if (!EntityAssemblies.Keys.Any(a => DescriptionManager.GetLocalizedAssembly(a, ci) != null))
                    return GetTypeInfoTS(culture.Parent ?? CultureInfo.GetCultureInfo("en"));

                var result = new Dictionary<string, TypeInfoTS>();
                result.AddRange(GetEntities(), "typeInfo");
                result.AddRange(GetSymbolContainers(), "typeInfo");
                result.AddRange(GetEnums(), "typeInfo");
                return result;
            });
        }

        private static Dictionary<string, TypeInfoTS> GetEntities()
        {
            var models = (from a in EntityAssemblies
                          from type in a.Key.GetTypes()
                          where typeof(ModelEntity).IsAssignableFrom(type) && !type.IsAbstract && a.Value.Contains(type.Namespace)
                          select type).ToList();

            var result = (from type in TypeLogic.TypeToEntity.Keys.Concat(models)
                          where !type.IsEnumEntity()
                          let descOptions = LocalizedAssembly.GetDescriptionOptions(type)
                          select KVP.Create(GetTypeName(type), new TypeInfoTS
                          {
                              Kind = KindOfType.Entity,
                              NiceName = descOptions.HasFlag(DescriptionOptions.Description) ? type.NiceName() : null,
                              NicePluralName = descOptions.HasFlag(DescriptionOptions.PluralDescription) ? type.NicePluralName() : null,
                              Gender = descOptions.HasFlag(DescriptionOptions.Gender) ? type.GetGender().ToString() : null,
                              EntityKind = type.IsIEntity() ? EntityKindCache.GetEntityKind(type) : (EntityKind?)null,
                              EntityData = type.IsIEntity() ? EntityKindCache.GetEntityData(type) : (EntityData?)null,
                              Members = PropertyRoute.GenerateRoutes(type)
                                .ToDictionary(p => p.PropertyString(), p => new MemberInfoTS
                                {
                                    NiceName = p.PropertyInfo?.NiceName(),
                                    Format = p.PropertyRouteType == PropertyRouteType.FieldOrProperty ? Reflector.FormatString(p) : null,
                                    Unit = p.PropertyInfo?.GetCustomAttribute<UnitAttribute>()?.UnitName,
                                    Type = new TypeReferenceTS(IsId(p) ? PrimaryKey.Type(type): p.PropertyInfo?.PropertyType, p.TryGetImplementations())
                                })
                          })).ToDictionary("entities");

            return result;
        }

        private static bool IsId(PropertyRoute p)
        {
            return p.PropertyInfo.Name == nameof(Entity.Id) && p.Parent.PropertyRouteType == PropertyRouteType.Root;
        }

        private static Dictionary<string, TypeInfoTS> GetEnums()
        {
            var result = (from a in EntityAssemblies
                          from type in a.Key.GetTypes()
                          where type.IsEnum
                          where a.Value.Contains(type.Namespace)
                          let descOptions = LocalizedAssembly.GetDescriptionOptions(type)
                          where descOptions != DescriptionOptions.None
                          let kind = type.Name.EndsWith("Query") ? KindOfType.Query :
                                     type.Name.EndsWith("Message") ? KindOfType.Message : KindOfType.Enum
                          select KVP.Create(GetTypeName(type), new TypeInfoTS
                          {
                              Kind = kind,
                              NiceName = descOptions.HasFlag(DescriptionOptions.Description) ? type.NiceName() : null,
                              Members = type.GetFields(staticFlags).ToDictionary(m => m.Name, m => new MemberInfoTS
                              {
                                  NiceName = m.NiceName(),
                              }),
                          })).ToDictionary("enums");

            return result;
        }

        private static Dictionary<string, TypeInfoTS> GetSymbolContainers()
        {
            var result = (from a in EntityAssemblies
                          from type in a.Key.GetTypes()
                          where type.IsStaticClass() && type.HasAttribute<AutoInitAttribute>()
                          where a.Value.Contains(type.Namespace)
                          let descOptions = LocalizedAssembly.GetDescriptionOptions(type)
                          where descOptions != DescriptionOptions.None
                          let kind = type.Name.EndsWith("Query") ? KindOfType.Query :
                                     type.Name.EndsWith("Message") ? KindOfType.Message : KindOfType.Enum
                          select KVP.Create(GetTypeName(type), new TypeInfoTS
                          {
                              Kind = KindOfType.SymbolContainer,
                              Members = type.GetFields(staticFlags).Where(f => GetSymbol(f).IdOrNull.HasValue).ToDictionary(m => m.Name, m => new MemberInfoTS
                              {
                                  NiceName = m.NiceName(),
                                  Id = GetSymbol(m).Id.Object
                              })
                          })).ToDictionary("symbols");

            return result;
        }

        private static Symbol GetSymbol(FieldInfo m)
        {
            var v = m.GetValue(null);

            if (v is IOperationSymbolContainer)
                v = ((IOperationSymbolContainer)v).Symbol;

            return ((Symbol)v);
        }

        public static string GetTypeName(Type t)
        {
            if (typeof(ModifiableEntity).IsAssignableFrom(t))
                return TypeLogic.TryGetCleanName(t) ?? t.Name;

            return t.Name;
        }
    }

    public class TypeInfoTS
    {
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "kind")]
        public KindOfType Kind { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "niceName")]
        public string NiceName { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "nicePluralName")]
        public string NicePluralName { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "gender")]
        public string Gender { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "entityKind")]
        public EntityKind? EntityKind { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "entityData")]
        public EntityData? EntityData { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "members")]
        public Dictionary<string, MemberInfoTS> Members { get; set; }
    }

    public class MemberInfoTS
    {
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "type")]
        public TypeReferenceTS Type { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "niceName")]
        public string NiceName { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "unit")]
        public string Unit { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "format")]
        public string Format { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "id")]
        public object Id { get; set; }
    }

    public class TypeReferenceTS
    {
        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore, PropertyName = "isCollection")]
        public bool IsCollection { get; set; }
        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore, PropertyName = "isLite")]
        public bool IsLite { get; set; }
        [JsonProperty(DefaultValueHandling = DefaultValueHandling.Ignore, PropertyName = "isNullable")]
        public bool IsNullable { get; set; }
        [JsonProperty(NullValueHandling = NullValueHandling.Ignore, PropertyName = "name")]
        public string Name { get; set; }

        public TypeReferenceTS(Type type, Implementations? implementations)
        {
            this.IsCollection = type.IsMList();
            this.IsLite = CleanMList(type).IsLite();
            this.IsNullable = type.IsNullable();
            this.Name = implementations?.Key() ?? TypeScriptType(type);
        }

        private static string TypeScriptType(Type type)
        {
            type = CleanMList(type);

            type = type.UnNullify().CleanType();

            return BasicType(type) ?? ReflectionCache.GetTypeName(type) ?? "any";
        }

        private static Type CleanMList(Type type)
        {
            if (type.IsMList())
                type = type.ElementType();
            return type;
        }

        public static string BasicType(Type type)
        {
            if (type.IsEnum)
                return null;

            switch (Type.GetTypeCode(type))
            {
                case TypeCode.Boolean: return "boolean";
                case TypeCode.Char: return "string";
                case TypeCode.SByte:
                case TypeCode.Byte:
                case TypeCode.Int16:
                case TypeCode.UInt16:
                case TypeCode.Int32:
                case TypeCode.UInt32:
                case TypeCode.Int64:
                case TypeCode.UInt64:
                case TypeCode.Single:
                case TypeCode.Double:
                case TypeCode.Decimal: return "number";
                case TypeCode.DateTime: return "datetime";
                case TypeCode.String: return "string";
            }
            return null;
        }

    }

    public enum KindOfType
    {
        Entity,
        Enum,
        Message,
        Query,
        SymbolContainer,
    }
}